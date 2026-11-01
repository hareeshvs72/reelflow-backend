import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const API_BASE = `https://graph.instagram.com/${env.INSTAGRAM_API_VERSION}`;

/**
 * Create a Reel media container on Instagram.
 * Step 1 of the two-step publishing process.
 *
 * @param {string} igUserId - Instagram user ID
 * @param {string} accessToken - Decrypted access token
 * @param {object} options
 * @param {string} options.videoUrl - Publicly accessible video URL (Cloudinary secure URL)
 * @param {string} options.caption - Caption text
 * @param {string} [options.coverUrl] - Optional cover image URL
 * @returns {Promise<{containerId: string}>}
 */
export async function createReelContainer(igUserId, accessToken, { videoUrl, caption, coverUrl }) {
  const body = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || '',
    share_to_feed: true,
  };

  if (coverUrl) body.thumb_offset = 0;

  const response = await fetch(`${API_BASE}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: accessToken }),
  });

  const data = await response.json();

  if (data.error) {
    const err = new Error(data.error.message || 'Failed to create media container');
    err.code = data.error.code;
    err.subcode = data.error.error_subcode;
    throw err;
  }

  if (!data.id) {
    throw new Error('No container ID returned from Instagram API');
  }

  return { containerId: data.id };
}

/**
 * Check the processing status of a media container.
 * @param {string} containerId
 * @param {string} accessToken
 * @returns {Promise<{status: string, statusCode: string}>}
 */
export async function checkContainerStatus(containerId, accessToken) {
  const response = await fetch(
    `${API_BASE}/${containerId}?fields=id,status,status_code&access_token=${accessToken}`
  );
  const data = await response.json();

  if (data.error) {
    const err = new Error(data.error.message);
    err.code = data.error.code;
    throw err;
  }

  return {
    status: data.status,
    statusCode: data.status_code, // EXPIRED, ERROR, FINISHED, IN_PROGRESS, PUBLISHED
  };
}

/**
 * Publish a processed media container.
 * Step 2 of the two-step publishing process.
 * IMPORTANT: Only call this after status_code === 'FINISHED'.
 *
 * @param {string} igUserId
 * @param {string} containerId
 * @param {string} accessToken
 * @returns {Promise<{mediaId: string}>}
 */
export async function publishContainer(igUserId, containerId, accessToken) {
  const response = await fetch(`${API_BASE}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: containerId,
      access_token: accessToken,
    }),
  });

  const data = await response.json();

  if (data.error) {
    const err = new Error(data.error.message || 'Failed to publish media');
    err.code = data.error.code;
    err.subcode = data.error.error_subcode;
    throw err;
  }

  if (!data.id) {
    throw new Error('No media ID returned from Instagram publish API');
  }

  return { mediaId: data.id };
}

/**
 * Check if a container was already published (idempotency guard).
 * Returns the media ID if it was published, null otherwise.
 *
 * @param {string} containerId
 * @param {string} accessToken
 * @returns {Promise<string|null>}
 */
export async function checkIfAlreadyPublished(containerId, accessToken) {
  try {
    const { statusCode } = await checkContainerStatus(containerId, accessToken);
    if (statusCode === 'PUBLISHED') {
      // Fetch the actual media ID via the container
      const resp = await fetch(
        `${API_BASE}/${containerId}?fields=id,status_code&access_token=${accessToken}`
      );
      const data = await resp.json();
      return data.id || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Poll until container reaches FINISHED or ERROR state.
 * Maximum ~5 minutes of polling with exponential-ish backoff.
 *
 * @param {string} containerId
 * @param {string} accessToken
 * @returns {Promise<void>}
 */
export async function waitForContainerReady(containerId, accessToken) {
  const delays = [5000, 10000, 15000, 20000, 30000, 30000, 30000, 60000, 60000, 60000];

  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay));
    const { statusCode } = await checkContainerStatus(containerId, accessToken);

    logger.debug('Container status poll', { containerId, statusCode });

    if (statusCode === 'FINISHED') return;
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`Container failed to process: ${statusCode}`);
    }
    // IN_PROGRESS — continue polling
  }

  throw new Error('Container processing timed out after ~5 minutes');
}
