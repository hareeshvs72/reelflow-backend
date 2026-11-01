import { sendError } from '../utils/api.js';
import { verifyAuthToken } from '../utils/auth.js';

/**
 * Resolve authenticated userId from either session or Bearer token.
 */
function resolveUserId(req) {
  if (req.session?.userId) return req.session.userId;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const tokenUserId = verifyAuthToken(token);
    if (tokenUserId) {
      if (!req.session) req.session = {};
      req.session.userId = tokenUserId;
      return tokenUserId;
    }
  }
  return null;
}

/**
 * Require an active session or valid Bearer token to access protected routes.
 */
export function requireAuth(req, res, next) {
  const userId = resolveUserId(req);
  if (!userId) {
    return sendError(res, 'Authentication required', 401);
  }
  req.userId = userId;
  next();
}

/**
 * Attach session or token userId to req.userId for convenience.
 */
export function attachUser(req, res, next) {
  req.userId = resolveUserId(req);
  next();
}
