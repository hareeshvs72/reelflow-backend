import { Router } from 'express';
import {
  connect,
  callback,
  getAccount,
  disconnect,
  getConfigStatus,
  testConnection,
  getReadiness,
} from '../controllers/instagram.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Public / setup inspection (handles optional session for user-specific account check)
router.get('/config-status', getConfigStatus);

// OAuth flow
router.get('/connect', requireAuth, connect);
router.get('/callback', callback); // Callback from Meta OAuth redirect

// Account management & verification
router.get('/account', requireAuth, getAccount);
router.get('/readiness', requireAuth, getReadiness);
router.post('/test-connection', requireAuth, testConnection);
router.post('/disconnect', requireAuth, disconnect);

export default router;
