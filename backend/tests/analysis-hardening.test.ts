import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';

process.env.ANALYSIS_RATE_LIMIT_MAX = '2';
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
        },
        creator: {
            count: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const { default: app } = await import('../src/index');

function makeAuthToken(userId = 'test-user') {
    return jwt.sign({ userId }, config.jwt.secret);
}

describe('Analysis validation and user-based rate limiting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(prisma.feedSnapshot.findFirst).mockResolvedValue({
            id: 'snapshot-1',
            userId: 'test-user',
            platform: 'youtube',
            capturedAt: new Date('2026-04-18T00:00:00.000Z'),
            feedItems: [
                {
                    creatorHandle: 'creator-a',
                    contentCategories: ['gaming'],
                    interactionType: 'like',
                    interacted: true,
                    watchDuration: 20,
                    positionInFeed: 0,
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
                        watchDuration: 18,
                        positionInFeed: 1,
                    },
                ],
            },
        ] as any);
        vi.mocked(prisma.user.count).mockResolvedValue(5 as any);
        vi.mocked(prisma.feedSnapshot.count).mockResolvedValue(10 as any);
        vi.mocked(prisma.feedItem.count).mockResolvedValue(25 as any);
        vi.mocked(prisma.creator.count).mockResolvedValue(4 as any);
    });

    it('rejects invalid analysis query params before service work runs', async () => {
        const token = makeAuthToken('analysis-user');

        const invalidLimit = await request(app)
            .get('/analysis/similar?limit=0')
            .set('Authorization', `Bearer ${token}`);

        expect(invalidLimit.status).toBe(400);
        expect(invalidLimit.body.error).toMatch(/limit must be between 1 and 20/i);

        const invalidBucket = await request(app)
            .get('/analysis/data-quality-trends?windowHours=336&bucketHours=99999')
            .set('Authorization', `Bearer ${token}`);

        expect(invalidBucket.status).toBe(400);
        expect(invalidBucket.body.error).toMatch(/bucketHours must be between 1 and 4320/i);
        expect(prisma.feedSnapshot.findFirst).not.toHaveBeenCalled();
        expect(prisma.feedSnapshot.findMany).not.toHaveBeenCalled();
    });

    it('rejects invalid public analysis query params', async () => {
        const response = await request(app)
            .get('/analysis/top-creators?limit=101');

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/limit must be between 1 and 100/i);
        expect(prisma.feedItem.groupBy).not.toHaveBeenCalled();
    });

    it('rate limits authenticated analysis by user id instead of shared ip', async () => {
        const firstUserToken = makeAuthToken('user-one');
        const secondUserToken = makeAuthToken('user-two');

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await request(app)
                .get('/analysis/similar?limit=5')
                .set('Authorization', `Bearer ${firstUserToken}`);

            expect(response.status).toBe(200);
        }

        const limited = await request(app)
            .get('/analysis/similar?limit=5')
            .set('Authorization', `Bearer ${firstUserToken}`);

        expect(limited.status).toBe(429);

        const secondUserResponse = await request(app)
            .get('/analysis/similar?limit=5')
            .set('Authorization', `Bearer ${secondUserToken}`);

        expect(secondUserResponse.status).toBe(200);
    });
});
