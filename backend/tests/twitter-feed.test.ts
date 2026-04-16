import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma.js';
import { resetIngestReplayGuardForTests } from '../src/services/ingestReplayGuard.js';

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

describe('Twitter Feed API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetIngestReplayGuardForTests();
    });

    it('should require auth', async () => {
        const res = await request(app)
            .post('/twitter/feed')
            .send({ feed: [{ videoId: 'tweet-1' }] });

        expect(res.status).toBe(401);
        expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
    });

    it('should reject payloads that fail @resma/shared contract validation', async () => {
        const res = await request(app)
            .post('/twitter/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{ caption: 'Missing videoId' }],
                sessionMetadata: {},
            });

        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
    });

    it('should reject payloads that contain partially invalid feed rows', async () => {
        const res = await request(app)
            .post('/twitter/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [
                    { videoId: 'tweet-1', caption: 'valid row' },
                    { caption: 'missing id row' },
                ],
                sessionMetadata: {},
            });

        expect(res.status).toBe(400);
        expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
    });

    it('persists valid twitter snapshots and normalizes shared-contract payloads', async () => {
        vi.mocked(prisma.feedSnapshot.create).mockResolvedValue({
            id: 'snapshot-twitter-1',
            _count: { feedItems: 1 },
        } as any);

        const res = await request(app)
            .post('/twitter/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send({
                feed: [{
                    url: 'https://x.com/example/status/1900123456789012345',
                    authorHandle: '@creator',
                    text: 'Tweet body',
                    impressionDuration: 4.2,
                    hasInteracted: true,
                    interactionType: 'like',
                    engagementMetrics: {
                        isPromoted: true,
                        likes: 12,
                    },
                }],
                sessionMetadata: {
                    captureSurface: 'Home Timeline',
                },
            });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ success: true, snapshotId: 'snapshot-twitter-1' });
        expect(prisma.feedSnapshot.create).toHaveBeenCalledTimes(1);
        expect(prisma.feedSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                platform: 'twitter',
                itemCount: 1,
                feedItems: {
                    create: [
                        expect.objectContaining({
                            videoId: '1900123456789012345',
                            creatorHandle: '@creator',
                            caption: 'Tweet body',
                            watchDuration: 4.2,
                            interacted: true,
                            interactionType: 'like',
                            contentCategories: ['promoted'],
                        }),
                    ],
                },
            }),
        }));
    });

    it('replays duplicate twitter uploads with same upload id', async () => {
        const transactionClient = {
            $executeRaw: vi.fn()
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0),
            $queryRaw: vi.fn().mockResolvedValue([
                { snapshotId: 'snapshot-twitter-replay' },
            ]),
            feedSnapshot: {
                create: vi.fn().mockResolvedValue({
                    id: 'snapshot-twitter-replay',
                    _count: { feedItems: 1 },
                }),
            },
        };

        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(transactionClient));

        const payload = {
            feed: [{ videoId: '1900123456789012345', caption: 'Replay test' }],
            sessionMetadata: {},
        };

        const first = await request(app)
            .post('/twitter/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .set('X-Resma-Upload-Id', 'twitter-upload-1')
            .send(payload);

        resetIngestReplayGuardForTests();

        const second = await request(app)
            .post('/twitter/feed')
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .set('X-Resma-Upload-Id', 'twitter-upload-1')
            .send(payload);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body).toEqual(first.body);
        expect(transactionClient.feedSnapshot.create).toHaveBeenCalledTimes(1);
        expect(transactionClient.$queryRaw).toHaveBeenCalledTimes(1);
    });
});
