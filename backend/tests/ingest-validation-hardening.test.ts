import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEED_ITEM_LIMIT_ERROR_MESSAGE, MAX_FEED_ITEMS } from '@resma/shared';
import app from '../src/index';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { resetIngestReplayGuardForTests } from '../src/services/ingestReplayGuard.js';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            create: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
            findUnique: vi.fn(),
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

describe('Shared ingest validation middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetIngestReplayGuardForTests();
    });

    it.each([
        [
            '/youtube/feed',
            {
                platform: 'twitter',
                feed: [{ videoId: 'abc123xyz78' }],
                sessionMetadata: {},
            },
        ],
        [
            '/instagram/feed',
            {
                platform: 'youtube',
                feed: [{ videoId: 'C9xAbCdEf12' }],
                sessionMetadata: {},
            },
        ],
        [
            '/twitter/feed',
            {
                platform: 'instagram',
                feed: [{ videoId: '1900123456789012345' }],
                sessionMetadata: {},
            },
        ],
    ])('rejects explicit platform mismatches on %s', async (path, payload) => {
        const response = await request(app)
            .post(path)
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send(payload);

        expect(response.status).toBe(400);
        expect(String(response.body.error)).toMatch(/Payload failed contract validation/);
        expect(prisma.feedSnapshot.create).not.toHaveBeenCalled();
    });

    it.each([
        [
            '/feeds',
            {
                platform: 'tiktok',
                feed: Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, index) => ({
                    videoId: `742901234567890${index}`,
                })),
                sessionMetadata: {},
            },
        ],
        [
            '/youtube/feed',
            {
                feed: Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, index) => ({
                    videoId: `abc123xyz${String(index).padStart(2, '0')}`,
                })),
                sessionMetadata: {},
            },
        ],
        [
            '/instagram/feed',
            {
                feed: Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, index) => ({
                    videoId: `C9xAbCdEf${String(index).padStart(3, '0')}`,
                })),
                sessionMetadata: {},
            },
        ],
        [
            '/twitter/feed',
            {
                feed: Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, index) => ({
                    videoId: `1900123456789${String(index).padStart(6, '0')}`,
                })),
                sessionMetadata: {},
            },
        ],
    ])('returns the shared feed limit error on %s', async (path, payload) => {
        const response = await request(app)
            .post(path)
            .set('Authorization', `Bearer ${makeAuthToken()}`)
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(FEED_ITEM_LIMIT_ERROR_MESSAGE);
        expect(prisma.feedSnapshot.create).not.toHaveBeenCalled();
    });
});
