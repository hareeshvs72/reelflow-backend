import { createLogger, format, transports } from 'winston';
import { env } from './env.js';

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${stack || message}`;
  if (Object.keys(meta).length) {
    // Never log tokens, secrets, or passwords
    const safe = { ...meta };
    ['token', 'secret', 'password', 'accessToken', 'cookie'].forEach((k) => delete safe[k]);
    log += ` ${JSON.stringify(safe)}`;
  }
  return log;
});

export const logger = createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    env.NODE_ENV === 'development' ? colorize() : format.uncolorize(),
    logFormat
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
  ],
});
