import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma.js';

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

describe('Feeds metadata deserialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps list responses healthy when one legacy metadata blob is malformed', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue([
            {
                id: 'bad-snapshot',
                userId: 'test-user',
                platform: 'tiktok',
                capturedAt: new Date('2026-04-15T00:00:00.000Z'),
                itemCount: 1,
                sessionMetadata: Buffer.from('{"broken":', 'utf-8'),
                _count: { feedItems: 1 },
            },
            {
                id: 'good-snapshot',
                userId: 'test-user',
                platform: 'tiktok',
                capturedAt: new Date('2026-04-14T00:00:00.000Z'),
                itemCount: 1,
                sessionMetadata: Buffer.from(JSON.stringify({ source: 'legacy-json' }), 'utf-8'),
                _count: { feedItems: 1 },
            },
        ] as any);
        vi.mocked(prisma.feedSnapshot.count).mockResolvedValue(2 as any);

        const res = await request(app)
            .get('/feeds')
            .set('Authorization', `Bearer ${makeAuthToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.data.snapshots).toHaveLength(2);
        expect(res.body.data.snapshots[0].sessionMetadata).toBeNull();
        expect(res.body.data.snapshots[1].sessionMetadata).toEqual({ source: 'legacy-json' });
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to parse legacy snapshot metadata',
            expect.objectContaining({
                snapshotId: 'bad-snapshot',
                field: 'sessionMetadata',
            })
        );

        warnSpy.mockRestore();
    });

    it('returns detail responses with null session metadata instead of throwing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        vi.mocked(prisma.feedSnapshot.findFirst).mockResolvedValue({
            id: 'detail-snapshot',
            userId: 'test-user',
            platform: 'tiktok',
            capturedAt: new Date('2026-04-15T00:00:00.000Z'),
            itemCount: 1,
            sessionMetadata: Buffer.from('not valid json', 'utf-8'),
            feedItems: [
                {
                    id: 'feed-item-1',
                    snapshotId: 'detail-snapshot',
                    videoId: 'video-1',
                    engagementMetrics: Buffer.from(JSON.stringify({ likes: 4 }), 'utf-8'),
                },
            ],
        } as any);

        const res = await request(app)
            .get('/feeds/detail-snapshot')
            .set('Authorization', `Bearer ${makeAuthToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.data.snapshot.sessionMetadata).toBeNull();
        expect(res.body.data.snapshot.feedItems[0].engagementMetrics).toEqual({ likes: 4 });
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to parse legacy snapshot metadata',
            expect.objectContaining({
                snapshotId: 'detail-snapshot',
                field: 'sessionMetadata',
            })
        );

        warnSpy.mockRestore();
    });
});
