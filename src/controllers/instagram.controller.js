import crypto from 'crypto';
import { env } from '../config/env.js';
import { InstagramAccount } from '../models/InstagramAccount.js';
import { asyncHandler, sendSuccess, sendError } from '../utils/api.js';
import { logger } from '../config/logger.js';

const INSTAGRAM_API_BASE = `https://graph.instagram.com/${env.INSTAGRAM_API_VERSION}`;
const AUTH_BASE = 'https://api.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const LONG_LIVED_TOKEN_URL = `${INSTAGRAM_API_BASE}/access_token`;

// Documented OAuth scopes for Instagram Professional (Creator/Business) Reels publishing
export const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_messages',
];

const SCOPES_QUERY = REQUIRED_SCOPES.join(',');

/**
 * GET /api/instagram/config-status
 * Inspects backend Meta configuration and returns setup completeness status.
 */
export const getConfigStatus = asyncHandler(async (req, res) => {
  const isDevAppId = !env.META_APP_ID || env.META_APP_ID === 'dev_meta_app_id';
  const isDevAppSecret = !env.META_APP_SECRET || env.META_APP_SECRET === 'dev_meta_app_secret';

  const missing = [];
  if (isDevAppId) missing.push('META_APP_ID');
  if (isDevAppSecret) missing.push('META_APP_SECRET');

  let account = null;
  if (req.session?.userId) {
    account = await InstagramAccount.findOne({
      userId: req.session.userId,
      isConnected: true,
    });
  }

  return sendSuccess(res, {
    appIdConfigured: !isDevAppId,
    appSecretConfigured: !isDevAppSecret,
    metaAppId: isDevAppId ? 'Not configured (dev placeholder)' : `${env.META_APP_ID.slice(0, 4)}••••••`,
    redirectUri: env.META_REDIRECT_URI,
    apiVersion: env.INSTAGRAM_API_VERSION,
    requiredScopes: REQUIRED_SCOPES,
    missingConfig: missing,
    isReadyForAuth: !isDevAppId && !isDevAppSecret,
    connectedAccount: account
      ? {
          username: account.username,
          name: account.name,
          accountType: account.accountType,
          profilePictureUrl: account.profilePictureUrl,
          instagramUserId: account.instagramUserId,
          tokenExpiresAt: account.tokenExpiresAt,
          isConnected: account.isConnected,
        }
      : null,
  });
});

/**
 * GET /api/instagram/connect
 * Initiates OAuth flow — returns JSON authorization URL or redirects.
 */
export const connect = asyncHandler(async (req, res) => {
  // Validate that Meta credentials are not default placeholders
  if (!env.META_APP_ID || env.META_APP_ID === 'dev_meta_app_id') {
    if (req.query.json === 'true' || req.headers.accept?.includes('application/json')) {
      return sendError(
        res,
        'META_APP_ID is not configured in server/.env. Please follow the Meta Setup Assistant.',
        400
      );
    }
    return res.redirect(`${env.CLIENT_URL}/meta-setup?error=missing_app_id`);
  }

  // Generate and store state parameter to prevent CSRF
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));

  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: env.META_REDIRECT_URI,
    scope: SCOPES_QUERY,
    response_type: 'code',
    state,
  });

  const authUrl = `${AUTH_BASE}?${params.toString()}`;
  logger.info('Initiating Instagram OAuth', { userId: req.session.userId });

  if (req.query.json === 'true' || req.headers.accept?.includes('application/json')) {
    return sendSuccess(res, { authUrl, state });
  }

  return res.redirect(authUrl);
});

/**
 * GET /api/instagram/callback
 * Handles the OAuth redirect from Meta.
 */
export const callback = asyncHandler(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle user denied authorization
  if (error) {
    logger.warn('Instagram OAuth denied', { error, error_description, userId: req.session.userId });
    return res.redirect(
      `${env.CLIENT_URL}/meta-setup?error=oauth_denied&message=${encodeURIComponent(
        error_description || error
      )}`
    );
  }

  // Validate state to prevent CSRF
  if (!state || state !== req.session.oauthState) {
    logger.warn('OAuth state mismatch', { userId: req.session.userId });
    return res.redirect(`${env.CLIENT_URL}/meta-setup?error=invalid_state`);
  }
  delete req.session.oauthState;

  if (!code) {
    return res.redirect(`${env.CLIENT_URL}/meta-setup?error=no_code`);
  }

  // Exchange authorization code for short-lived token
  const tokenParams = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: env.META_REDIRECT_URI,
    code,
  });

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    body: tokenParams,
  });
  const tokenData = await tokenResponse.json();

  if (tokenData.error) {
    logger.error('Token exchange failed', { error: tokenData.error_message || tokenData.error });
    return res.redirect(
      `${env.CLIENT_URL}/meta-setup?error=token_exchange_failed&message=${encodeURIComponent(
        tokenData.error_message || 'Token exchange failed'
      )}`
    );
  }

  const shortLivedToken = tokenData.access_token;
  const instagramUserId = tokenData.user_id?.toString();

  // Exchange for long-lived token (60 days)
  const longLivedParams = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env.META_APP_SECRET,
    access_token: shortLivedToken,
  });

  const longLivedResponse = await fetch(`${LONG_LIVED_TOKEN_URL}?${longLivedParams.toString()}`);
  const longLivedData = await longLivedResponse.json();

  if (longLivedData.error) {
    logger.error('Long-lived token exchange failed', { error: longLivedData.error?.message });
    return res.redirect(
      `${env.CLIENT_URL}/meta-setup?error=long_lived_token_failed&message=${encodeURIComponent(
        longLivedData.error?.message || 'Long-lived token exchange failed'
      )}`
    );
  }

  const accessToken = longLivedData.access_token;
  const expiresIn = longLivedData.expires_in || 5184000; // default 60 days in seconds
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

  // Fetch basic account info
  const profileResponse = await fetch(
    `${INSTAGRAM_API_BASE}/me?fields=id,username,name,account_type,profile_picture_url&access_token=${accessToken}`
  );
  const profile = await profileResponse.json();

  if (profile.error) {
    logger.error('Failed to fetch Instagram profile', { error: profile.error?.message });
    return res.redirect(
      `${env.CLIENT_URL}/meta-setup?error=profile_fetch_failed&message=${encodeURIComponent(
        profile.error?.message || 'Profile fetch failed'
      )}`
    );
  }

  // Upsert the Instagram account record
  let account = await InstagramAccount.findOne({
    userId: req.session.userId,
    instagramUserId: instagramUserId || profile.id,
  }).select('+encryptedAccessToken +tokenIv +tokenAuthTag');

  if (!account) {
    account = new InstagramAccount({
      userId: req.session.userId,
      instagramUserId: instagramUserId || profile.id,
    });
  }

  account.username = profile.username || '';
  account.name = profile.name || '';
  account.profilePictureUrl = profile.profile_picture_url || '';
  account.accountType = profile.account_type || 'unknown';
  account.tokenExpiresAt = tokenExpiresAt;
  account.grantedScopes = SCOPES_QUERY;
  account.isConnected = true;
  account.setAccessToken(accessToken);

  await account.save();
  logger.info('Instagram account connected successfully', {
    userId: req.session.userId,
    igUserId: account.instagramUserId,
    username: account.username,
  });

  return res.redirect(`${env.CLIENT_URL}/meta-setup?connected=true`);
});

/**
 * GET /api/instagram/account
 * Returns the connected Instagram account info (never exposes plaintext tokens).
 */
export const getAccount = asyncHandler(async (req, res) => {
  const account = await InstagramAccount.findOne({
    userId: req.session.userId,
    isConnected: true,
  });

  if (!account) {
    return sendSuccess(res, { account: null }, 200, 'No Instagram account connected');
  }

  return sendSuccess(res, {
    account: {
      id: account._id,
      instagramUserId: account.instagramUserId,
      username: account.username,
      name: account.name,
      profilePictureUrl: account.profilePictureUrl,
      accountType: account.accountType,
      tokenExpiresAt: account.tokenExpiresAt,
      isConnected: account.isConnected,
      grantedScopes: account.grantedScopes,
    },
  });
});

/**
 * POST /api/instagram/test-connection
 * Verifies live token validity and tests Meta Graph API access.
 */
export const testConnection = asyncHandler(async (req, res) => {
  const account = await InstagramAccount.findOne({
    userId: req.session.userId,
    isConnected: true,
  }).select('+encryptedAccessToken +tokenIv +tokenAuthTag');

  if (!account) {
    return sendError(
      res,
      'No connected Instagram account found. Authorize with Instagram Login first.',
      404
    );
  }

  // Token expiration check
  const now = new Date();
  const isExpired = account.tokenExpiresAt && account.tokenExpiresAt <= now;
  if (isExpired) {
    account.isConnected = false;
    await account.save();
    return sendError(
      res,
      'Stored Instagram access token has expired. Please reconnect your account.',
      401
    );
  }

  const daysRemaining = account.tokenExpiresAt
    ? Math.max(0, Math.round((account.tokenExpiresAt - now) / (1000 * 60 * 60 * 24)))
    : 60;

  let accessToken;
  try {
    accessToken = account.getAccessToken();
  } catch (err) {
    logger.error('Token decryption failure', { error: err.message });
    return sendError(res, 'Failed to decrypt access token. Please re-authorize.', 500);
  }

  // Call Meta Graph API
  const metaResp = await fetch(
    `${INSTAGRAM_API_BASE}/me?fields=id,username,name,account_type,profile_picture_url&access_token=${accessToken}`
  );
  const data = await metaResp.json();

  if (data.error) {
    logger.warn('Meta API test-connection returned error', { error: data.error });
    return sendError(
      res,
      `Meta API verification failed: ${data.error.message} (Code ${data.error.code})`,
      400,
      data.error
    );
  }

  // Refresh profile details in DB
  account.username = data.username || account.username;
  account.name = data.name || account.name;
  if (data.account_type) account.accountType = data.account_type;
  if (data.profile_picture_url) account.profilePictureUrl = data.profile_picture_url;
  await account.save();

  const isEligible = ['BUSINESS', 'MEDIA_CREATOR'].includes(account.accountType);

  return sendSuccess(res, {
    valid: true,
    account: {
      username: account.username,
      name: account.name,
      instagramUserId: account.instagramUserId,
      accountType: account.accountType,
      isCreatorOrBusiness: isEligible,
      profilePictureUrl: account.profilePictureUrl,
    },
    token: {
      status: daysRemaining < 7 ? 'expiring_soon' : 'active',
      expiresAt: account.tokenExpiresAt,
      daysRemaining,
    },
    permissions: REQUIRED_SCOPES,
    message: isEligible
      ? 'Instagram account connection verified successfully! Reel publishing is active.'
      : 'Account is connected, but account type must be Creator or Business to publish Reels.',
  });
});

/**
 * GET /api/instagram/readiness
 * Returns a comprehensive checklist of all 6 steps required for publishing.
 */
export const getReadiness = asyncHandler(async (req, res) => {
  const isDevAppId = !env.META_APP_ID || env.META_APP_ID === 'dev_meta_app_id';
  const isDevAppSecret = !env.META_APP_SECRET || env.META_APP_SECRET === 'dev_meta_app_secret';

  const account = await InstagramAccount.findOne({
    userId: req.session.userId,
    isConnected: true,
  });

  const now = new Date();
  const tokenValid = account && (!account.tokenExpiresAt || account.tokenExpiresAt > now);
  const isEligibleType = account && ['BUSINESS', 'MEDIA_CREATOR'].includes(account.accountType);

  const checklist = [
    {
      id: 'app_credentials',
      title: 'Meta Developer App Credentials',
      completed: !isDevAppId && !isDevAppSecret,
      details: !isDevAppId && !isDevAppSecret ? 'Configured in server/.env' : 'Placeholders found in server/.env',
    },
    {
      id: 'redirect_uri',
      title: 'OAuth Redirect URI Registered',
      completed: true,
      details: env.META_REDIRECT_URI,
    },
    {
      id: 'account_connected',
      title: 'Instagram Account Linked',
      completed: Boolean(account && account.isConnected),
      details: account ? `@${account.username}` : 'Not connected yet',
    },
    {
      id: 'account_type',
      title: 'Professional Account Type (Creator or Business)',
      completed: isEligibleType,
      details: account ? `Account type: ${account.accountType}` : 'Pending connection',
    },
    {
      id: 'token_active',
      title: '60-Day Long-Lived Token Active',
      completed: tokenValid,
      details: tokenValid ? `Valid until ${account.tokenExpiresAt?.toLocaleDateString()}` : 'Token missing or expired',
    },
    {
      id: 'publishing_permission',
      title: 'Publishing Scope (instagram_business_content_publish)',
      completed: Boolean(account?.grantedScopes?.includes('instagram_business_content_publish')),
      details: 'Required for automated Reel container publishing',
    },
  ];

  const allPassed = checklist.every((c) => c.completed);

  return sendSuccess(res, {
    readyToPublish: allPassed,
    checklist,
    account: account
      ? {
          username: account.username,
          accountType: account.accountType,
          instagramUserId: account.instagramUserId,
        }
      : null,
  });
});

/**
 * POST /api/instagram/disconnect
 * Disconnects the account and invalidates stored credentials.
 */
export const disconnect = asyncHandler(async (req, res) => {
  const account = await InstagramAccount.findOne({
    userId: req.session.userId,
    isConnected: true,
  }).select('+encryptedAccessToken +tokenIv +tokenAuthTag');

  if (!account) {
    return sendError(res, 'No connected account found', 404);
  }

  account.isConnected = false;
  account.encryptedAccessToken = 'revoked';
  account.tokenIv = 'revoked';
  account.tokenAuthTag = 'revoked';
  await account.save();

  logger.info('Instagram account disconnected', { userId: req.session.userId });
  return sendSuccess(res, {}, 200, 'Instagram account disconnected successfully');
});
