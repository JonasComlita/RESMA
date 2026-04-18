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
    it('returns capped limit metadata and aggregate observatory source info', async () => {
        const token = jwt.sign({ userId: 'user-1' }, config.jwt.secret);
        vi.mocked(prisma.feedItem.findMany).mockResolvedValue([
            { creatorHandle: 'creator-a' },
            { creatorHandle: 'creator-b' },
        ] as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue([
            {
                id: 'snapshot-2',
                userId: 'user-2',
                capturedAt: new Date('2026-04-17T00:00:00.000Z'),
                feedItems: [{ creatorHandle: 'creator-a' }, { creatorHandle: 'creator-c' }],
            },
        ] as any);

        const response = await request(app)
            .get('/analysis/similar?limit=200')
            .set('Authorization', `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.data.similarFeeds).toHaveLength(1);
        expect(response.body.data.meta).toMatchObject({
            requestedLimit: 200,
            appliedLimit: 20,
            truncated: true,
            candidateCount: 1,
            privacyMode: 'aggregate-only',
            source: 'observatory-cohorts',
        });
        expect(typeof response.body.data.meta.durationMs).toBe('number');
    });
});
