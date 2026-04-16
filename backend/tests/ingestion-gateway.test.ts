import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { config } from '../src/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetIngestReplayGuardForTests } from '../src/services/ingestReplayGuard.js';
import { FEED_ITEM_LIMIT_ERROR_MESSAGE, MAX_FEED_ITEMS } from '@resma/shared';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    feedSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    feedItem: {
      findFirst: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    creator: {
      count: vi.fn(),
    },
  },
}));

function makeAuthToken() {
  return jwt.sign({ userId: 'test-user' }, config.jwt.secret);
}

describe('Ingestion gateway auth and contract baselines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIngestReplayGuardForTests();
  });

  it.each(['/feeds', '/instagram/feed', '/twitter/feed'])('requires auth on %s', async (path) => {
    const payload = path === '/feeds'
      ? { platform: 'tiktok', feed: [{ videoId: 'abc123' }], sessionMetadata: {} }
      : { feed: [{ videoId: 'abc123' }], sessionMetadata: {} };

    const res = await request(app)
      .post(path)
      .send(payload);

    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
  });

  it('rejects /feeds payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'tiktok',
        feed: [{ videoId: '' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation|Video ID required/);
  });

  it('rejects /feeds payloads with unsupported explicit platform', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'myspace',
        feed: [{ videoId: 'abc123' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects twitter payloads sent to /feeds instead of coercing them through the tiktok gateway', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'twitter',
        feed: [{ videoId: '1900123456789012345', caption: 'tweet payload in wrong route' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
    expect(prisma.feedSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects oversized /feeds payloads with a clear item limit error', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'tiktok',
        feed: Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, index) => ({
          videoId: `742901234567890${index}`,
        })),
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(FEED_ITEM_LIMIT_ERROR_MESSAGE);
  });

  it('rejects /youtube/feed payloads that contain partially invalid feed rows', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [
          { videoId: 'abc123xyz78', title: 'valid row' },
          { title: 'missing id row' },
        ],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /instagram/feed payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [{ caption: 'Missing videoId' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /instagram/feed payloads that contain partially invalid feed rows', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [
          { videoId: 'C9xAbCdEf12', caption: 'valid row' },
          { caption: 'missing id row' },
        ],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /twitter/feed payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/twitter/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [{ text: 'Missing status id' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });
});
