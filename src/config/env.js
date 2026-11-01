import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  CLIENT_URL: z.string().url().default('https://reelflow-nu.vercel.app'),
  SERVER_URL: z.string().url().default('https://reelflow-5s62.onrender.com'),
  MONGODB_URI: z.string().min(10),
  REDIS_URL: z.string().min(5),
  SESSION_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_REDIRECT_URI: z.string().url().default('https://reelflow-5s62.onrender.com/api/instagram/callback'),
  INSTAGRAM_API_VERSION: z.string().default('v21.0'),
  ALLOWED_ORIGINS: z.string().default('https://reelflow-nu.vercel.app,http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid or missing environment variables:\n');
  parsed.error.issues.forEach((issue) => {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('\nCopy server/.env.example to server/.env and fill in all values.\n');
  process.exit(1);
}

export const env = parsed.data;
