import mongoose from 'mongoose';

export const POST_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  PUBLISHED: 'published',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const postSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    instagramAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InstagramAccount',
      default: null,
    },
    // File metadata
    originalFileName: { type: String, required: true },
    cloudinaryPublicId: { type: String, required: true },
    videoUrl: { type: String, required: true }, // Secure Cloudinary URL
    thumbnailUrl: { type: String, default: '' },
    fileSize: { type: Number, default: 0 }, // bytes
    duration: { type: Number, default: 0 }, // seconds
    format: { type: String, default: 'mp4' },

    // Caption
    caption: { type: String, default: '', maxlength: 2200 },
    hashtags: { type: [String], default: [] },
    altText: { type: String, default: '' },

    // Scheduling
    scheduledAt: { type: Date, default: null }, // UTC
    timezone: { type: String, default: 'Asia/Kolkata' },

    // Status
    status: {
      type: String,
      enum: Object.values(POST_STATUS),
      default: POST_STATUS.DRAFT,
      index: true,
    },

    // Publishing results
    instagramMediaId: { type: String, default: null },
    publishedAt: { type: Date, default: null },

    // Reliability tracking
    attemptCount: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    bullJobId: { type: String, default: null }, // BullMQ job reference
  },
  { timestamps: true }
);

// Compound indexes for common queries
postSchema.index({ userId: 1, status: 1 });
postSchema.index({ userId: 1, scheduledAt: 1 });
postSchema.index({ status: 1, scheduledAt: 1 }); // Worker query

export const Post = mongoose.model('Post', postSchema);
