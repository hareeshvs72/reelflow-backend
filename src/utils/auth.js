import crypto from 'crypto';
import { env } from '../config/env.js';

/**
 * Generate a signed bearer token for cross-origin authentication
 * (essential when modern browsers block third-party cookies across different domains).
 * @param {string} userId
 * @returns {string} token
 */
export function generateAuthToken(userId) {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verify signed bearer token and extract userId
 * @param {string} token
 * @returns {string|null} userId
 */
export function verifyAuthToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expectedSig = crypto
      .createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    if (signature !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data.userId || null;
  } catch {
    return null;
  }
}
