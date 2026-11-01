import { sendError } from '../utils/api.js';

/**
 * Require an active session to access protected routes.
 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return sendError(res, 'Authentication required', 401);
  }
  next();
}

/**
 * Attach session userId to req.userId for convenience.
 */
export function attachUser(req, res, next) {
  req.userId = req.session?.userId || null;
  next();
}
