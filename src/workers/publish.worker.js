/**
 * ReelFlow Publishing Worker
 *
 * Run independently with: npm run worker
 * This process handles scheduled Instagram Reel publishing jobs from BullMQ.
 * It must run alongside the main server for publishing to work.
 */
import 'dotenv/config';
import { Worker } from 'bullmq';
import mongoose from 'mongoose';
import { connectDB } from '../config/database.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { QUEUE_NAME } from '../queues/publish.queue.js';
import { Post, POST_STATUS } from '../models/Post.js';
import { PublishingAttempt } from '../models/PublishingAttempt.js';
import { InstagramAccount } from '../models/InstagramAccount.js';
import {
  createReelContainer,
  waitForContainerReady,
  publishContainer,
  checkIfAlreadyPublished,
} from '../services/instagram.service.js';

// Transient errors that are safe to retry
const RETRYABLE_ERROR_CODES = [
  1, 2, 4, 17, 341, // Meta API transient errors
  -1, // Unknown / network
];

async function processPublishJob(job) {
  const { postId } = job.data;
  logger.info('Processing publish job', { jobId: job.id, postId });

  // Load post and validate ownership
  const post = await Post.findById(postId);
  if (!post) {
    logger.warn('Post not found, discarding job', { postId });
    return; // Don't retry
  }

  // Guard: Don't republish already published posts
  if (post.status === POST_STATUS.PUBLISHED) {
    logger.info('Post already published, skipping', { postId });
    return;
  }

  // Guard: Only process scheduled posts
  if (![POST_STATUS.SCHEDULED, POST_STATUS.FAILED].includes(post.status)) {
    logger.warn('Post in unexpected state, skipping', { postId, status: post.status });
    return;
  }

  // Guard: Cancelled post
  if (post.status === POST_STATUS.CANCELLED) {
    logger.info('Post cancelled, skipping', { postId });
    return;
  }

  // Load Instagram account
  const account = await InstagramAccount.findOne({
    userId: post.userId,
    isConnected: true,
  }).select('+encryptedAccessToken +tokenIv +tokenAuthTag');

  if (!account) {
    const err = new Error('No connected Instagram account found for this user');
    err.nonRetryable = true;
    throw err;
  }

  const accessToken = account.getAccessToken();
  const attemptNumber = post.attemptCount + 1;

  // Create an attempt record
  const attempt = await PublishingAttempt.create({
    postId: post._id,
    userId: post.userId,
    attemptNumber,
    startedAt: new Date(),
  });

  // Mark post as processing
  post.status = POST_STATUS.PROCESSING;
  post.attemptCount = attemptNumber;
  await post.save();

  try {
    let containerId;

    // Idempotency: If a previous attempt created a container, check its status
    const lastAttempt = await PublishingAttempt.findOne({
      postId: post._id,
      attemptNumber: { $lt: attemptNumber },
      containerId: { $exists: true, $ne: null },
    }).sort({ attemptNumber: -1 });

    if (lastAttempt?.containerId) {
      logger.info('Found previous container, checking if already published', {
        containerId: lastAttempt.containerId,
      });
      const existingMediaId = await checkIfAlreadyPublished(lastAttempt.containerId, accessToken);
      if (existingMediaId) {
        // Already published in a previous uncertain attempt
        post.status = POST_STATUS.PUBLISHED;
        post.instagramMediaId = existingMediaId;
        post.publishedAt = new Date();
        post.lastError = null;
        await post.save();

        attempt.outcome = 'success';
        attempt.instagramMediaId = existingMediaId;
        attempt.completedAt = new Date();
        await attempt.save();

        logger.info('Post was already published (idempotency check)', { postId, existingMediaId });
        return;
      }
      containerId = lastAttempt.containerId;
    }

    // Step 1: Create Reel container (if not already done)
    if (!containerId) {
      const fullCaption = [post.caption, post.hashtags.map((h) => `#${h}`).join(' ')]
        .filter(Boolean)
        .join('\n\n');

      const result = await createReelContainer(account.instagramUserId, accessToken, {
        videoUrl: post.videoUrl,
        caption: fullCaption,
      });
      containerId = result.containerId;

      // Save container ID for idempotency
      attempt.containerId = containerId;
      await attempt.save();

      logger.info('Container created', { postId, containerId });
    }

    // Step 2: Wait for container to finish processing
    await waitForContainerReady(containerId, accessToken);
    logger.info('Container ready', { postId, containerId });

    // Step 3: Publish
    const { mediaId } = await publishContainer(account.instagramUserId, containerId, accessToken);
    logger.info('Post published', { postId, mediaId });

    // Update post to published
    post.status = POST_STATUS.PUBLISHED;
    post.instagramMediaId = mediaId;
    post.publishedAt = new Date();
    post.lastError = null;
    post.bullJobId = null;
    await post.save();

    attempt.outcome = 'success';
    attempt.instagramMediaId = mediaId;
    attempt.completedAt = new Date();
    await attempt.save();
  } catch (err) {
    logger.error('Publish job failed', {
      postId,
      attemptNumber,
      message: err.message,
      code: err.code,
    });

    attempt.outcome = err.nonRetryable ? 'failure' : 'failure';
    attempt.errorCode = err.code?.toString();
    attempt.errorMessage = err.message;
    attempt.completedAt = new Date();
    await attempt.save();

    const isRetryable = !err.nonRetryable && RETRYABLE_ERROR_CODES.includes(err.code);
    const willRetry = job.attemptsMade < (job.opts.attempts - 1) && isRetryable;

    if (!willRetry) {
      post.status = POST_STATUS.FAILED;
      post.lastError = err.message;
      post.bullJobId = null;
      await post.save();
    } else {
      post.status = POST_STATUS.SCHEDULED; // Will retry
      post.lastError = err.message;
      await post.save();
    }

    throw err; // Let BullMQ handle retry / failure
  }
}

async function startWorker() {
  await connectDB();

  const worker = new Worker(QUEUE_NAME, processPublishJob, {
    connection: getRedis(),
    concurrency: 3, // Process 3 jobs in parallel
    limiter: {
      max: 10,
      duration: 60_000, // Max 10 jobs per minute (stay within Meta rate limits)
    },
  });

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Job failed', {
      jobId: job?.id,
      attempt: job?.attemptsMade,
      message: err.message,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { message: err.message });
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down worker`);
    await worker.close();
    await mongoose.connection.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Publishing worker started and listening for jobs');
}

startWorker().catch((err) => {
  logger.error('Failed to start worker', { message: err.message });
  process.exit(1);
});
