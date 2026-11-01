import { Router } from 'express';
import {
  getUploadSignature,
  completeUpload,
  getPosts,
  getPost,
  updatePost,
  deletePost,
} from '../controllers/upload.controller.js';
import {
  schedulePost,
  bulkSchedule,
  cancelPost,
  reschedulePost,
  retryPost,
  getPublishingHistory,
  getPublishingStatus,
  getDashboardStats,
} from '../controllers/schedule.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { scheduleSchema, bulkScheduleSchema, captionSchema } from '../validators/post.validator.js';
import rateLimit from 'express-rate-limit';

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: { success: false, message: 'Upload limit reached. Try again in 1 hour.' },
});

const router = Router();
router.use(requireAuth);

// Upload
router.post('/uploads/signature', uploadLimiter, getUploadSignature);
router.post('/uploads/complete', uploadLimiter, completeUpload);

// Posts CRUD
router.get('/posts', getPosts);
router.get('/posts/:id', getPost);
router.patch('/posts/:id', validateBody(captionSchema), updatePost);
router.delete('/posts/:id', deletePost);

// Scheduling
router.post('/posts/:id/schedule', validateBody(scheduleSchema), schedulePost);
router.post('/posts/bulk-schedule', validateBody(bulkScheduleSchema), bulkSchedule);
router.post('/posts/:id/cancel', cancelPost);
router.post('/posts/:id/reschedule', validateBody(scheduleSchema), reschedulePost);
router.post('/posts/:id/retry', retryPost);

// Publishing
router.get('/publishing/history', getPublishingHistory);
router.get('/publishing/status', getPublishingStatus);

// Dashboard
router.get('/dashboard/stats', getDashboardStats);

export default router;
