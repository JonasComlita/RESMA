import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';

process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.INGEST_RATE_LIMIT_MAX = '2';
process.env.ANALYSIS_RATE_LIMIT_MAX = '2';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.INGEST_RATE_LIMIT_WINDOW_MS = '60000';
process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            create: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
            delete: vi.fn(),
            findUnique: vi.fn(),
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

vi.resetModules();

const { default: app } = await import('../src/index');

describe('Route rate limiting', () => {
    it.each([
        ['/auth/login', () => ({})],
        ['/auth/register', () => ({})],
        ['/auth/recover', () => ({ recoveryCode: 'ABCD-EFGH-IJKL-MNOP', newPassword: 'supersecret123' })],
        ['/feeds', () => ({ platform: 'tiktok', feed: [{ videoId: '7429012345678901234' }], sessionMetadata: {} })],
        ['/youtube/feed', () => ({ feed: [{ videoId: 'abc123xyz78' }], sessionMetadata: {} })],
        ['/instagram/feed', () => ({ feed: [{ videoId: 'C9xAbCdEf12' }], sessionMetadata: {} })],
        ['/twitter/feed', () => ({ feed: [{ videoId: 'tweet-123' }], sessionMetadata: {} })],
    ])('returns 429 after repeated requests on %s', async (path, makeBody) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await request(app)
                .post(path)
                .send(makeBody());

            expect(response.status).not.toBe(429);
        }

        const limited = await request(app)
            .post(path)
            .send(makeBody());

        expect(limited.status).toBe(429);
        expect(limited.body).toMatchObject({
            success: false,
            error: 'Too many requests, please try again later.',
        });
    });

    it('returns 429 after repeated authenticated requests on /analysis/similar', async () => {
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
                ],
            },
        ] as any);

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await request(app)
                .get('/analysis/similar?limit=5')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).not.toBe(429);
        }

        const limited = await request(app)
            .get('/analysis/similar?limit=5')
            .set('Authorization', `Bearer ${token}`);

        expect(limited.status).toBe(429);
        expect(limited.body).toMatchObject({
            success: false,
            error: 'Too many requests, please try again later.',
        });
    });
});
