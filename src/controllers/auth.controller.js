import { User } from '../models/User.js';
import { asyncHandler, sendSuccess, sendError } from '../utils/api.js';
import { logger } from '../config/logger.js';

export const register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  const exists = await User.findOne({ email });
  if (exists) {
    return sendError(res, 'Email already registered', 409);
  }

  // passwordHash field triggers the pre-save bcrypt hook
  const user = await User.create({ name, email, passwordHash: password });

  req.session.userId = user._id.toString();
  logger.info('User registered', { userId: user._id });

  return sendSuccess(res, { user }, 201, 'Account created successfully');
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Explicitly select passwordHash (it's excluded by default)
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    return sendError(res, 'Invalid email or password', 401);
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    return sendError(res, 'Invalid email or password', 401);
  }

  req.session.userId = user._id.toString();
  req.session.save();
  logger.info('User logged in', { userId: user._id });

  // Strip passwordHash from response
  const userData = user.toJSON();
  return sendSuccess(res, { user: userData }, 200, 'Login successful');
});

export const logout = asyncHandler(async (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy error', { message: err.message });
    }
  });
  res.clearCookie('reelflow.sid');
  logger.info('User logged out', { userId });
  return sendSuccess(res, {}, 200, 'Logged out successfully');
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.userId);
  if (!user) {
    return sendError(res, 'User not found', 404);
  }
  return sendSuccess(res, { user });
});
