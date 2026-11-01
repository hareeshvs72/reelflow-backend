import mongoose from 'mongoose';
import { encryptToken, decryptToken } from '../utils/crypto.js';

const instagramAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Instagram user ID (numeric string from the API)
    instagramUserId: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      default: '',
    },
    name: {
      type: String,
      default: '',
    },
    profilePictureUrl: {
      type: String,
      default: '',
    },
    accountType: {
      type: String,
      enum: ['BUSINESS', 'MEDIA_CREATOR', 'PERSONAL', 'unknown'],
      default: 'unknown',
    },
    // AES-256-GCM encrypted access token — never stored plaintext
    encryptedAccessToken: {
      type: String,
      required: true,
      select: false,
    },
    // iv and authTag stored alongside for decryption
    tokenIv: { type: String, required: true, select: false },
    tokenAuthTag: { type: String, required: true, select: false },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    // Space-separated list of granted scopes
    grantedScopes: {
      type: String,
      default: '',
    },
    isConnected: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

instagramAccountSchema.index({ userId: 1, instagramUserId: 1 }, { unique: true });

// Store encrypted token
instagramAccountSchema.methods.setAccessToken = function (plainToken) {
  const { encrypted, iv, authTag } = encryptToken(plainToken);
  this.encryptedAccessToken = encrypted;
  this.tokenIv = iv;
  this.tokenAuthTag = authTag;
};

// Retrieve decrypted token
instagramAccountSchema.methods.getAccessToken = function () {
  return decryptToken(this.encryptedAccessToken, this.tokenIv, this.tokenAuthTag);
};

export const InstagramAccount = mongoose.model('InstagramAccount', instagramAccountSchema);
