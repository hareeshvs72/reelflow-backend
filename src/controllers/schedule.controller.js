import { Post, POST_STATUS } from '../models/Post.js';
import { PublishingAttempt } from '../models/PublishingAttempt.js';
import { InstagramAccount } from '../models/InstagramAccount.js';
import { asyncHandler, sendSuccess, sendError } from '../utils/api.js';
import { schedulePublishJob, cancelPublishJob } from '../queues/publish.queue.js';
import { logger } from '../config/logger.js';

/**
 * POST /api/posts/:id/schedule
 */
export const schedulePost = asyncHandler(async (req, res) => {
  const { scheduledAt, timezone } = req.body;
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);

  if ([POST_STATUS.PUBLISHED, POST_STATUS.PROCESSING].includes(post.status)) {
    return sendError(res, 'Cannot reschedule a published or processing post', 409);
  }

  // Cancel any existing job
  if (post.bullJobId) {
    await cancelPublishJob(post.bullJobId).catch(() => null);
  }

  const scheduledDate = new Date(scheduledAt);
  post.scheduledAt = scheduledDate;
  post.timezone = timezone || post.timezone;
  post.status = POST_STATUS.SCHEDULED;
  post.lastError = null;

  // Schedule the BullMQ job — delay in ms from now
  const delay = Math.max(0, scheduledDate.getTime() - Date.now());
  let jobId = null;
  try {
    jobId = await schedulePublishJob(post._id.toString(), delay);
  } catch (err) {
    logger.warn('Could not enqueue to Redis (offline). Post saved and scheduled in MongoDB.', {
      error: err.message,
      postId: post._id,
    });
  }
  post.bullJobId = jobId;

  await post.save();
  logger.info('Post scheduled', { postId: post._id, scheduledAt, delay, queuedInRedis: Boolean(jobId) });
  return sendSuccess(
    res,
    { post, queuedInRedis: Boolean(jobId) },
    200,
    jobId ? 'Post scheduled' : 'Post scheduled in database (connect Redis for automated background worker)'
  );
});

/**
 * POST /api/posts/bulk-schedule
 */
export const bulkSchedule = asyncHandler(async (req, res) => {
  const { posts: scheduleItems } = req.body;
  const results = [];

  for (const item of scheduleItems) {
    try {
      const post = await Post.findOne({
        _id: item.postId,
        userId: req.session.userId,
      });
      if (!post) {
        results.push({ postId: item.postId, success: false, error: 'Post not found' });
        continue;
      }
      if ([POST_STATUS.PUBLISHED, POST_STATUS.PROCESSING].includes(post.status)) {
        results.push({ postId: item.postId, success: false, error: 'Cannot reschedule' });
        continue;
      }

      if (post.bullJobId) await cancelPublishJob(post.bullJobId).catch(() => null);

      const scheduledDate = new Date(item.scheduledAt);
      const delay = Math.max(0, scheduledDate.getTime() - Date.now());
      let jobId = null;
      try {
        jobId = await schedulePublishJob(post._id.toString(), delay);
      } catch (e) {
        logger.warn('Could not enqueue bulk job to Redis (offline)', { postId: post._id });
      }

      post.scheduledAt = scheduledDate;
      post.timezone = item.timezone || post.timezone;
      post.status = POST_STATUS.SCHEDULED;
      post.bullJobId = jobId;
      post.lastError = null;
      await post.save();

      results.push({ postId: item.postId, success: true, queuedInRedis: Boolean(jobId) });
    } catch (err) {
      results.push({ postId: item.postId, success: false, error: err.message });
    }
  }

  return sendSuccess(res, { results }, 200, 'Bulk schedule complete');
});

/**
 * POST /api/posts/:id/cancel
 */
export const cancelPost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);

  if (post.status !== POST_STATUS.SCHEDULED) {
    return sendError(res, 'Only scheduled posts can be cancelled', 409);
  }

  if (post.bullJobId) await cancelPublishJob(post.bullJobId).catch(() => null);

  post.status = POST_STATUS.CANCELLED;
  post.bullJobId = null;
  await post.save();

  return sendSuccess(res, { post }, 200, 'Post cancelled');
});

/**
 * POST /api/posts/:id/reschedule
 */
export const reschedulePost = asyncHandler(async (req, res) => {
  // Reuse schedule logic
  req.params.id = req.params.id;
  return schedulePost(req, res);
});

/**
 * POST /api/posts/:id/retry
 * Manually retry a failed post.
 */
export const retryPost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);

  if (post.status !== POST_STATUS.FAILED) {
    return sendError(res, 'Only failed posts can be retried', 409);
  }

  const delay = 5000; // Retry in 5 seconds
  let jobId = null;
  try {
    jobId = await schedulePublishJob(post._id.toString(), delay);
  } catch (e) {
    logger.warn('Could not enqueue retry job to Redis (offline)', { postId: post._id });
  }
  post.bullJobId = jobId;
  post.status = POST_STATUS.SCHEDULED;
  post.scheduledAt = new Date(Date.now() + delay);
  post.lastError = null;
  await post.save();

  return sendSuccess(res, { post, queuedInRedis: Boolean(jobId) }, 200, 'Retry queued');
});

/**
 * GET /api/publishing/history
 */
export const getPublishingHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const filter = {
    userId: req.session.userId,
    status: { $in: [POST_STATUS.PUBLISHED, POST_STATUS.FAILED, POST_STATUS.CANCELLED] },
  };

  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit)),
    Post.countDocuments(filter),
  ]);

  return sendSuccess(res, { posts, total, page: Number(page), limit: Number(limit) });
});

/**
 * GET /api/publishing/status
 * Returns current queue status for all posts.
 */
export const getPublishingStatus = asyncHandler(async (req, res) => {
  const posts = await Post.find({ userId: req.session.userId })
    .select('status scheduledAt publishedAt lastError bullJobId')
    .sort({ scheduledAt: 1 });

  return sendSuccess(res, { posts });
});

/**
 * GET /api/dashboard/stats
 */
export const getDashboardStats = asyncHandler(async (req, res) => {
  const userId = req.session.userId;

  const [total, scheduled, published, failed, upcoming, recent] = await Promise.all([
    Post.countDocuments({ userId }),
    Post.countDocuments({ userId, status: POST_STATUS.SCHEDULED }),
    Post.countDocuments({ userId, status: POST_STATUS.PUBLISHED }),
    Post.countDocuments({ userId, status: POST_STATUS.FAILED }),
    Post.find({ userId, status: POST_STATUS.SCHEDULED })
      .sort({ scheduledAt: 1 })
      .limit(5)
      .select('originalFileName scheduledAt timezone thumbnailUrl'),
    Post.find({ userId, status: { $in: [POST_STATUS.PUBLISHED, POST_STATUS.FAILED] } })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('originalFileName status publishedAt lastError thumbnailUrl instagramMediaId'),
  ]);

  const instagramAccount = await InstagramAccount.findOne({ userId, isConnected: true })
    .select('username name profilePictureUrl isConnected tokenExpiresAt');

  return sendSuccess(res, {
    stats: { total, scheduled, published, failed },
    upcoming,
    recent,
    instagramAccount,
  });
});
