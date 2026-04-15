import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.INGEST_RATE_LIMIT_MAX = '2';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.INGEST_RATE_LIMIT_WINDOW_MS = '60000';

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

vi.resetModules();

const { default: app } = await import('../src/index');

describe('Route rate limiting', () => {
    it.each([
        ['/auth/login', () => ({})],
        ['/auth/register', () => ({})],
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
});
