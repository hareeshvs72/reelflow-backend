import { z } from 'zod';

export const scheduleSchema = z.object({
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be a valid ISO 8601 datetime string' })
    .refine(
      (d) => new Date(d) > new Date(Date.now() + 60_000), // Must be at least 1 minute in future
      { message: 'Scheduled time must be at least 1 minute in the future' }
    ),
  timezone: z.string().min(1).default('Asia/Kolkata'),
});

export const bulkScheduleSchema = z.object({
  posts: z
    .array(
      z.object({
        postId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid post ID'),
        scheduledAt: z
          .string()
          .datetime()
          .refine((d) => new Date(d) > new Date(Date.now() + 60_000), {
            message: 'Scheduled time must be in the future',
          }),
        timezone: z.string().min(1).default('Asia/Kolkata'),
      })
    )
    .min(1, 'At least one post required')
    .max(20, 'Maximum 20 posts per bulk schedule'),
});

export const captionSchema = z.object({
  caption: z.string().max(2200, 'Caption cannot exceed 2200 characters').optional().default(''),
  hashtags: z.array(z.string().max(100)).max(30).optional().default([]),
  altText: z.string().max(500).optional().default(''),
  timezone: z.string().optional(),
});
