/**
 * Wraps async route handlers so Express catches rejected promises.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Standard API success response helper.
 */
export const sendSuccess = (res, data = {}, statusCode = 200, message = 'Success') => {
  return res.status(statusCode).json({ success: true, message, data });
};

/**
 * Standard API error response helper.
 */
export const sendError = (res, message = 'An error occurred', statusCode = 500, errors = null) => {
  const payload = { success: false, message };
  if (errors) payload.errors = errors;
  return res.status(statusCode).json(payload);
};
