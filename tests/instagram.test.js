import { jest } from '@jest/globals';
import {
  createReelContainer,
  checkContainerStatus,
  publishContainer,
  checkIfAlreadyPublished,
} from '../src/services/instagram.service.js';

describe('Instagram Meta API Integration Tests (Mocked)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('createReelContainer', () => {
    it('successfully creates a container and returns containerId', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({ id: '17923456789012345' }),
      });

      const result = await createReelContainer('123456789', 'mock_access_token', {
        videoUrl: 'https://res.cloudinary.com/demo/video/upload/sample.mp4',
        caption: 'Automated Reel via ReelFlow #automation',
      });

      expect(result).toHaveProperty('containerId', '17923456789012345');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('throws descriptive error when Meta API returns an error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          error: {
            message: 'Invalid video URL: URL must be publicly accessible',
            code: 352,
            error_subcode: 2207001,
          },
        }),
      });

      await expect(
        createReelContainer('123456789', 'mock_token', {
          videoUrl: 'http://localhost/video.mp4',
        })
      ).rejects.toThrow('Invalid video URL');
    });

    it('throws error when no container ID is returned', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({}),
      });

      await expect(
        createReelContainer('123456789', 'mock_token', {
          videoUrl: 'https://example.com/video.mp4',
        })
      ).rejects.toThrow('No container ID returned');
    });
  });

  describe('checkContainerStatus', () => {
    it('returns status_code FINISHED when container is ready', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          id: '17923456789012345',
          status: 'Ready',
          status_code: 'FINISHED',
        }),
      });

      const status = await checkContainerStatus('17923456789012345', 'mock_token');
      expect(status.statusCode).toBe('FINISHED');
    });

    it('returns status_code IN_PROGRESS when video is still rendering', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          id: '17923456789012345',
          status_code: 'IN_PROGRESS',
        }),
      });

      const status = await checkContainerStatus('17923456789012345', 'mock_token');
      expect(status.statusCode).toBe('IN_PROGRESS');
    });
  });

  describe('publishContainer', () => {
    it('publishes the media container and returns Instagram media ID', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({ id: '18099887766554433' }),
      });

      const result = await publishContainer('123456789', '17923456789012345', 'mock_token');
      expect(result).toHaveProperty('mediaId', '18099887766554433');
    });

    it('handles rate limits or publishing failure gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          error: {
            message: 'Application request limit reached',
            code: 4,
          },
        }),
      });

      await expect(
        publishContainer('123456789', '17923456789012345', 'mock_token')
      ).rejects.toThrow('Application request limit reached');
    });
  });

  describe('checkIfAlreadyPublished (Idempotency Guard)', () => {
    it('detects already published container and returns media ID without duplicate publish', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          json: async () => ({
            id: '17923456789012345',
            status_code: 'PUBLISHED',
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({
            id: '18099887766554433',
          }),
        });

      const mediaId = await checkIfAlreadyPublished('17923456789012345', 'mock_token');
      expect(mediaId).toBe('18099887766554433');
    });

    it('returns null if container is not published yet', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        json: async () => ({
          id: '17923456789012345',
          status_code: 'FINISHED',
        }),
      });

      const mediaId = await checkIfAlreadyPublished('17923456789012345', 'mock_token');
      expect(mediaId).toBeNull();
    });
  });
});
