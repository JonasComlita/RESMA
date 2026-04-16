import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_INGEST_VERSION } from '@resma/shared';
import app from '../src/index';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma.js';
import { resetIngestReplayGuardForTests } from '../src/services/ingestReplayGuard.js';
import { decompressAndUnpack } from '../src/services/serialization.js';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    feedSnapshot: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    ingestEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
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

describe('Instagram Feed API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIngestReplayGuardForTests();
  });

  it('should require auth', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .send({ feed: [{ videoId: 'C9xAbCdEf12' }] });

    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
  });

  it('should reject payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ feed: [{ caption: 'Missing videoId' }] });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('persists valid instagram snapshots and stores enriched session metadata', async () => {
    vi.mocked(prisma.feedSnapshot.create).mockResolvedValue({
      id: 'snapshot-instagram-1',
      _count: { feedItems: 1 },
    } as any);

    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [{
          url: 'https://www.instagram.com/reel/C9xAbCdEf12/?igsh=abc',
          username: 'creator_name',
          caption: 'Example reel',
          impressionDuration: 3.2,
          type: 'Reel',
          recommendations: [{
            url: 'https://www.instagram.com/reel/C1ZxYwVuT98/?igsh=next',
            surface: 'Reels Rail',
          }],
        }],
        sessionMetadata: {
          captureSurface: 'Reels Tray',
          sessionKey: ' ig-session-1 ',
        },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, snapshotId: 'snapshot-instagram-1' });
    expect(prisma.feedSnapshot.create).toHaveBeenCalledTimes(1);

    const createArgs = vi.mocked(prisma.feedSnapshot.create).mock.calls[0]?.[0];
    expect(createArgs).toBeDefined();
    expect(createArgs).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        platform: 'instagram',
        itemCount: 1,
        sessionMetadata: expect.any(Buffer),
        feedItems: {
          create: [
            expect.objectContaining({
              videoId: 'C9xAbCdEf12',
              creatorHandle: 'creator_name',
              creatorId: 'creator_name',
              caption: 'Example reel',
              watchDuration: 3.2,
              contentCategories: ['reel'],
            }),
          ],
        },
      }),
    }));

    const compressedSessionMetadata = createArgs?.data.sessionMetadata;
    expect(compressedSessionMetadata).toBeInstanceOf(Buffer);

    const persistedSessionMetadata = decompressAndUnpack<Record<string, any>>(compressedSessionMetadata);
    expect(persistedSessionMetadata).toMatchObject({
      type: 'REEL_WATCH',
      captureSurface: 'reels-tray',
      clientSessionId: 'ig-session-1',
      ingestVersion: CURRENT_INGEST_VERSION,
      quality: expect.objectContaining({
        schemaVersion: 1,
        fingerprintSize: 1,
      }),
    });
  });

  it('replays duplicate instagram uploads with the same upload id', async () => {
    const transactionClient = {
      $executeRaw: vi.fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0),
      $queryRaw: vi.fn().mockResolvedValue([
        { snapshotId: 'snapshot-instagram-replay' },
      ]),
      feedSnapshot: {
        create: vi.fn().mockResolvedValue({
          id: 'snapshot-instagram-replay',
          _count: { feedItems: 1 },
        }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(transactionClient));

    const payload = {
      feed: [{
        videoId: 'C9xAbCdEf12',
        caption: 'Replay reel',
        engagementMetrics: {
          recommendationCount: 1,
          recommendations: [{
            videoId: 'C1ZxYwVuT98',
            surface: 'Reels Rail',
          }],
        },
      }],
      sessionMetadata: {},
    };

    const first = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .set('X-Resma-Upload-Id', 'instagram-upload-1')
      .send(payload);

    resetIngestReplayGuardForTests();

    const second = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .set('X-Resma-Upload-Id', 'instagram-upload-1')
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(transactionClient.feedSnapshot.create).toHaveBeenCalledTimes(1);
    expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
