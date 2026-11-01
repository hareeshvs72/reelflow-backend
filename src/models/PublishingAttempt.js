import mongoose from 'mongoose';

const publishingAttemptSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Post',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    attemptNumber: { type: Number, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    outcome: {
      type: String,
      enum: ['success', 'failure', 'uncertain'],
      default: null,
    },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    // Instagram media container ID (safe to store, used for idempotency checks)
    containerId: { type: String, default: null },
    // Instagram's returned media ID on success
    instagramMediaId: { type: String, default: null },
  },
  { timestamps: false }
);

publishingAttemptSchema.index({ postId: 1, attemptNumber: 1 });

export const PublishingAttempt = mongoose.model('PublishingAttempt', publishingAttemptSchema);
