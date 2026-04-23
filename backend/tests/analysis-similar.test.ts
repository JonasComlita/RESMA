import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';

process.env.ANALYSIS_RATE_LIMIT_MAX = '100';
process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
            findUnique: vi.fn(),
        },
        feedItem: {
            findMany: vi.fn(),
            findFirst: vi.fn(),
            groupBy: vi.fn(),
            count: vi.fn(),
        },
        user: {
            count: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        creator: {
            count: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const { default: app } = await import('../src/index');

describe('/analysis/similar', () => {
    it('returns capped limit metadata and upgraded similarity method info', async () => {
        const token = jwt.sign({ userId: 'user-1' }, config.jwt.secret);
        vi.mocked(prisma.feedSnapshot.findFirst).mockResolvedValue({
            id: 'snapshot-1',
            userId: 'user-1',
            platform: 'youtube',
            capturedAt: new Date('2026-04-18T00:00:00.000Z'),
            feedItems: [
                {
                    creatorHandle: 'creator-a',
                    contentCategories: ['gaming'],
                    interactionType: 'like',
                    interacted: true,
                    watchDuration: 18,
                    positionInFeed: 0,
                },
                {
                    creatorHandle: 'creator-b',
                    contentCategories: ['gaming', 'commentary'],
                    interactionType: 'watch',
                    interacted: false,
                    watchDuration: 14,
                    positionInFeed: 4,
                },
            ],
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue([
            {
                id: 'snapshot-2',
                userId: 'user-2',
                platform: 'youtube',
                capturedAt: new Date('2026-04-17T00:00:00.000Z'),
                feedItems: [
                    {
                        creatorHandle: 'creator-a',
                        contentCategories: ['gaming'],
                        interactionType: 'like',
                        interacted: true,
                        watchDuration: 16,
                        positionInFeed: 1,
                    },
                    {
                        creatorHandle: 'creator-c',
                        contentCategories: ['gaming'],
                        interactionType: 'watch',
                        interacted: false,
                        watchDuration: 10,
                        positionInFeed: 6,
                    },
                ],
            },
        ] as any);

        const response = await request(app)
            .get('/analysis/similar?limit=20')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.data.similarFeeds).toHaveLength(1);
        expect(response.body.data.similarFeeds[0]).toMatchObject({
            snapshotId: 'snapshot-2',
            userId: 'user-2',
            platform: 'youtube',
        });
        expect(response.body.data.similarFeeds[0].commonCategories).toContain('gaming');
        expect(response.body.data.similarFeeds[0].signalBreakdown).toMatchObject({
            creatorOverlap: expect.any(Number),
            categoryOverlap: expect.any(Number),
            behaviorAlignment: expect.any(Number),
        });
        expect(response.body.data.meta).toMatchObject({
            requestedLimit: 20,
            appliedLimit: 20,
            truncated: false,
            candidateCount: 1,
            privacyMode: 'aggregate-only',
            source: 'observatory-cohorts',
            method: 'weighted-snapshot-profile-v1',
            targetSnapshotId: 'snapshot-1',
        });
        expect(prisma.feedSnapshot.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    platform: 'youtube',
                }),
            })
        );
        expect(typeof response.body.data.meta.durationMs).toBe('number');
    });
});
