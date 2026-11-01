import IORedis from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

let redisClient;

export function getRedis() {
  if (!redisClient) {
    const isTls = env.REDIS_URL.startsWith('rediss://');

    redisClient = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times) => {
        // Backoff: wait up to 10s between reconnect attempts instead of spamming every 2s
        return Math.min(times * 1000, 10000);
      },
    });

    redisClient.on('connect', () => logger.info('Redis connected successfully'));
    redisClient.on('error', (err) => logger.error('Redis error', { message: err.message }));
    redisClient.on('reconnecting', (ms) => logger.warn(`Redis reconnecting in ${ms}ms…`));
  }
  return redisClient;
}
