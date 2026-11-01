import { Queue } from 'bullmq';
import { getRedis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export const QUEUE_NAME = 'instagram-publish';

let publishQueue;

export function getPublishQueue() {
  if (!publishQueue) {
    publishQueue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 30_000, // 30 seconds initial, then 1m, 2m, 4m, 8m
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });

    logger.info('BullMQ publish queue initialized');
  }
  return publishQueue;
}

/**
 * Schedule a publish job with a delay.
 * @param {string} postId - MongoDB Post ID
 * @param {number} delay - Milliseconds from now
 * @returns {Promise<string>} job ID
 */
export async function schedulePublishJob(postId, delay) {
  const queue = getPublishQueue();
  const job = await queue.add(
    'publish-reel',
    { postId },
    {
      delay: Math.max(0, delay),
      jobId: `post-${postId}`, // Deduplicate: same postId won't create duplicate job
    }
  );
  logger.info('Publish job scheduled', { jobId: job.id, postId, delay });
  return job.id;
}

/**
 * Cancel a scheduled publish job.
 * @param {string} jobId - BullMQ job ID
 */
export async function cancelPublishJob(jobId) {
  const queue = getPublishQueue();
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
    logger.info('Publish job removed', { jobId });
  }
}
