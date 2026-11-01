import { cloudinary } from '../config/cloudinary.js';
import { Post, POST_STATUS } from '../models/Post.js';
import { asyncHandler, sendSuccess, sendError } from '../utils/api.js';
import { logger } from '../config/logger.js';

// Instagram video requirements (as of 2024)
const MAX_FILE_SIZE_BYTES = 1_000_000_000; // 1 GB Instagram limit
const ALLOWED_FORMATS = ['mp4', 'mov'];
const MAX_DURATION_SECONDS = 900; // 15 minutes for Reels

/**
 * POST /api/uploads/signature
 * Generates a signed Cloudinary upload signature so the browser
 * can upload directly without exposing the API secret.
 */
export const getUploadSignature = asyncHandler(async (req, res) => {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `reelflow/${req.session.userId}`;

  const paramsToSign = {
    folder,
    timestamp,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET
  );

  return sendSuccess(res, {
    signature,
    timestamp,
    folder,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
  });
});

/**
 * POST /api/uploads/complete
 * Called after a successful Cloudinary upload.
 * Validates the upload and creates a Post record.
 */
export const completeUpload = asyncHandler(async (req, res) => {
  const { publicId, secureUrl, originalFilename, bytes, duration, format } = req.body;

  if (!publicId || !secureUrl) {
    return sendError(res, 'publicId and secureUrl are required', 400);
  }

  // Validate format
  const ext = (format || '').toLowerCase();
  if (!ALLOWED_FORMATS.includes(ext)) {
    // Clean up the invalid upload from Cloudinary
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    } catch (_) {}
    return sendError(res, `Unsupported format: ${ext}. Only MP4 and MOV are accepted.`, 422);
  }

  // Validate file size
  if (bytes > MAX_FILE_SIZE_BYTES) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    } catch (_) {}
    return sendError(res, 'File exceeds 1 GB Instagram limit', 422);
  }

  // Validate duration
  if (duration && duration > MAX_DURATION_SECONDS) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
    } catch (_) {}
    return sendError(res, 'Video duration exceeds 15 minutes (Instagram Reel limit)', 422);
  }

  const post = await Post.create({
    userId: req.session.userId,
    originalFileName: originalFilename || publicId,
    cloudinaryPublicId: publicId,
    videoUrl: secureUrl,
    fileSize: bytes || 0,
    duration: duration || 0,
    format: ext,
    status: POST_STATUS.DRAFT,
  });

  logger.info('Upload completed', { postId: post._id, userId: req.session.userId });
  return sendSuccess(res, { post }, 201, 'Upload saved');
});

/**
 * GET /api/posts
 */
export const getPosts = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { userId: req.session.userId };
  if (status) filter.status = status;

  const [posts, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit)),
    Post.countDocuments(filter),
  ]);

  return sendSuccess(res, { posts, total, page: Number(page), limit: Number(limit) });
});

/**
 * GET /api/posts/:id
 */
export const getPost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);
  return sendSuccess(res, { post });
});

/**
 * PATCH /api/posts/:id
 * Update caption, hashtags, alt text.
 */
export const updatePost = asyncHandler(async (req, res) => {
  const { caption, hashtags, altText, timezone } = req.body;
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);

  if ([POST_STATUS.PUBLISHED, POST_STATUS.PROCESSING].includes(post.status)) {
    return sendError(res, 'Cannot edit a published or processing post', 409);
  }

  if (caption !== undefined) post.caption = caption;
  if (hashtags !== undefined) post.hashtags = hashtags;
  if (altText !== undefined) post.altText = altText;
  if (timezone !== undefined) post.timezone = timezone;

  await post.save();
  return sendSuccess(res, { post }, 200, 'Post updated');
});

/**
 * DELETE /api/posts/:id
 */
export const deletePost = asyncHandler(async (req, res) => {
  const post = await Post.findOne({ _id: req.params.id, userId: req.session.userId });
  if (!post) return sendError(res, 'Post not found', 404);

  if ([POST_STATUS.PUBLISHED, POST_STATUS.PROCESSING].includes(post.status)) {
    return sendError(res, 'Cannot delete a published or processing post', 409);
  }

  // Remove from Cloudinary
  try {
    await cloudinary.uploader.destroy(post.cloudinaryPublicId, { resource_type: 'video' });
    logger.info('Cloudinary video deleted', { publicId: post.cloudinaryPublicId });
  } catch (err) {
    logger.warn('Cloudinary delete failed', { publicId: post.cloudinaryPublicId, message: err.message });
  }

  await post.deleteOne();
  return sendSuccess(res, {}, 200, 'Post deleted');
});
