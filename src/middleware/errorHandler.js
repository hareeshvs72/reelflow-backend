import { sendError } from '../utils/api.js';

/**
 * Express error handler middleware.
 * Handles Zod validation errors, Mongoose errors, and generic errors.
 */
export function errorHandler(err, req, res, next) {
  // Zod validation errors
  if (err.name === 'ZodError') {
    const errors = err.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
    return sendError(res, 'Validation failed', 422, errors);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return sendError(res, `${field} already exists`, 409);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return sendError(res, 'Validation failed', 422, errors);
  }

  // Mongoose cast error (invalid ObjectId etc.)
  if (err.name === 'CastError') {
    return sendError(res, `Invalid ${err.path}`, 400);
  }

  // Default
  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'Internal server error'
      : err.message || 'Internal server error';

  return sendError(res, message, statusCode);
}
