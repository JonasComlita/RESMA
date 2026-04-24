import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { resetAudienceForecastMaterializationForTests } from '../src/services/audienceForecast.js';
import { resetAudienceFeedItemsCacheForTests } from '../src/services/audienceForecastLoader.js';

process.env.ANALYSIS_RATE_LIMIT_MAX = '100';
process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        $disconnect: vi.fn(),
        feedSnapshot: {
            aggregate: vi.fn(),
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

const jsonMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

function makeToken(userId = 'viewer-1') {
    return jwt.sign({ userId }, config.jwt.secret);
}

function createSnapshot(
    id: string,
    userId: string,
    capturedAt: string,
    items: Array<{
        videoId: string;
        creatorHandle: string;
        categories: string[];
        recommendations?: Array<{ videoId: string; position?: number }>;
    }>,
    sessionMetadata: Buffer | null = null
) {
    return {
        id,
        userId,
        capturedAt: new Date(capturedAt),
        sessionMetadata,
        feedItems: items.map((item, index) => ({
            videoId: item.videoId,
            creatorHandle: item.creatorHandle,
            contentCategories: item.categories,
            engagementMetrics: jsonMetrics(item.recommendations ?? []),
            positionInFeed: index,
        })),
    };
}

function buildSnapshotFixtures(includeCurrentUser = true, invalidMetadata = false) {
    const sessionMetadata = invalidMetadata ? Buffer.from('invalid-session-metadata', 'utf-8') : null;
    const snapshots = [
        createSnapshot('snap-u1', 'viewer-1', '2026-04-22T00:00:00.000Z', [
            { videoId: 'gseed1', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed2', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed3', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid2', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-u2', 'viewer-2', '2026-04-22T00:05:00.000Z', [
            { videoId: 'gseed1', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed4', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed5', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid2', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-u3', 'viewer-3', '2026-04-22T00:10:00.000Z', [
            { videoId: 'gseed1', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed6', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid1', position: 1 }] },
            { videoId: 'gseed7', creatorHandle: 'streamer-a', categories: ['gaming'], recommendations: [{ videoId: 'gmid2', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-m1', 'bridge-1', '2026-04-22T00:15:00.000Z', [
            { videoId: 'gmid1', creatorHandle: 'connector-a', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed2', creatorHandle: 'connector-b', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed3', creatorHandle: 'connector-c', categories: ['mixed'], recommendations: [{ videoId: 'bridge002', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-m2', 'bridge-2', '2026-04-22T00:20:00.000Z', [
            { videoId: 'gmid1', creatorHandle: 'connector-d', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed4', creatorHandle: 'connector-e', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed5', creatorHandle: 'connector-f', categories: ['mixed'], recommendations: [{ videoId: 'bridge002', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-m3', 'bridge-3', '2026-04-22T00:25:00.000Z', [
            { videoId: 'gmid1', creatorHandle: 'connector-g', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed6', creatorHandle: 'connector-h', categories: ['mixed'], recommendations: [{ videoId: 'bridge001', position: 1 }] },
            { videoId: 'mseed7', creatorHandle: 'connector-i', categories: ['mixed'], recommendations: [{ videoId: 'bridge002', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-b1', 'beauty-1', '2026-04-22T00:30:00.000Z', [
            { videoId: 'bridge001', creatorHandle: 'beauty-a', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed2', creatorHandle: 'beauty-b', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed3', creatorHandle: 'beauty-c', categories: ['beauty'], recommendations: [{ videoId: 'oppo002', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-b2', 'beauty-2', '2026-04-22T00:35:00.000Z', [
            { videoId: 'bridge001', creatorHandle: 'beauty-d', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed4', creatorHandle: 'beauty-e', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed5', creatorHandle: 'beauty-f', categories: ['beauty'], recommendations: [{ videoId: 'oppo002', position: 1 }] },
        ], sessionMetadata),
        createSnapshot('snap-b3', 'beauty-3', '2026-04-22T00:40:00.000Z', [
            { videoId: 'bridge001', creatorHandle: 'beauty-g', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed6', creatorHandle: 'beauty-h', categories: ['beauty'], recommendations: [{ videoId: 'oppo001', position: 1 }] },
            { videoId: 'bseed7', creatorHandle: 'beauty-i', categories: ['beauty'], recommendations: [{ videoId: 'oppo002', position: 1 }] },
        ], sessionMetadata),
    ];

    return includeCurrentUser ? snapshots : snapshots.filter((snapshot) => snapshot.userId !== 'viewer-1');
}

describe('/analysis/opposite-discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAudienceForecastMaterializationForTests();
        resetAudienceFeedItemsCacheForTests();
        vi.mocked(prisma.feedSnapshot.aggregate).mockResolvedValue({
            _count: { _all: 9 },
            _max: { capturedAt: new Date('2026-04-22T00:40:00.000Z') },
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(buildSnapshotFixtures(true, false) as any);
        vi.mocked(prisma.feedItem.findMany).mockResolvedValue([]);
    });

    it('returns opposite-discovery results with aggregate-only metadata', async () => {
        const response = await request(app)
            .get('/analysis/opposite-discovery?platform=youtube&limit=10')
            .set('Authorization', `Bearer ${makeToken('viewer-1')}`);

        expect(response.status).toBe(200);
        expect(response.body.data.meta).toMatchObject({
            privacyMode: 'aggregate-only',
            source: 'observatory-cohorts',
            confidenceDegraded: false,
            qualityGateStatus: 'ok',
        });
        expect(response.body.data.result.bubble.level).toBeDefined();
        expect(response.body.data.result.oppositeCohorts[0].dominantCategory).toBe('beauty');
        expect(response.body.data.result.candidates.some((candidate: any) => candidate.videoId === 'oppo001')).toBe(true);
        expect(response.body.data.result.bridgeContent.some((bridge: any) => bridge.bestPath.join('->') === 'gmid1->bridge001->oppo001')).toBe(true);
    });

    it('surfaces degraded confidence when metadata integrity is poor', async () => {
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(buildSnapshotFixtures(true, true) as any);

        const response = await request(app)
            .get('/analysis/opposite-discovery?platform=youtube')
            .set('Authorization', `Bearer ${makeToken('viewer-1')}`);

        expect(response.status).toBe(200);
        expect(response.body.data.meta.qualityGateStatus).toBe('degraded');
        expect(response.body.data.meta.confidenceDegraded).toBe(true);
        expect(response.body.data.result.qualityGate.degradationReasons.length).toBeGreaterThan(0);
    });

    it('falls back to the contributor profile when they are missing from the materialized cohort model', async () => {
        vi.mocked(prisma.feedSnapshot.aggregate).mockResolvedValue({
            _count: { _all: 8 },
            _max: { capturedAt: new Date('2026-04-22T00:40:00.000Z') },
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(buildSnapshotFixtures(false, false) as any);
        vi.mocked(prisma.feedItem.findMany).mockResolvedValue([
            {
                videoId: 'gseed1',
                creatorHandle: 'streamer-a',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'gmid1', position: 1 }]),
                snapshot: { capturedAt: new Date('2026-04-22T00:00:00.000Z') },
            },
            {
                videoId: 'gseed2',
                creatorHandle: 'streamer-a',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'gmid1', position: 1 }]),
                snapshot: { capturedAt: new Date('2026-04-22T00:05:00.000Z') },
            },
            {
                videoId: 'gseed3',
                creatorHandle: 'streamer-a',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'gmid2', position: 1 }]),
                snapshot: { capturedAt: new Date('2026-04-22T00:10:00.000Z') },
            },
        ] as any);

        const response = await request(app)
            .get('/analysis/opposite-discovery?platform=youtube')
            .set('Authorization', `Bearer ${makeToken('viewer-1')}`);

        expect(response.status).toBe(200);
        expect(response.body.data.result.currentCohort.materialized).toBe(false);
        expect(response.body.data.result.candidates.length).toBeGreaterThan(0);
    });

    it('returns a 404 when the contributor still lacks enough usable history for fallback profiling', async () => {
        vi.mocked(prisma.feedSnapshot.aggregate).mockResolvedValue({
            _count: { _all: 8 },
            _max: { capturedAt: new Date('2026-04-22T00:40:00.000Z') },
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(buildSnapshotFixtures(false, false) as any);
        vi.mocked(prisma.feedItem.findMany).mockResolvedValue([
            {
                videoId: 'gseed1',
                creatorHandle: 'streamer-a',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'gmid1', position: 1 }]),
                snapshot: { capturedAt: new Date('2026-04-22T00:00:00.000Z') },
            },
            {
                videoId: 'gseed2',
                creatorHandle: 'streamer-a',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'gmid1', position: 1 }]),
                snapshot: { capturedAt: new Date('2026-04-22T00:05:00.000Z') },
            },
        ] as any);

        const response = await request(app)
            .get('/analysis/opposite-discovery?platform=youtube')
            .set('Authorization', `Bearer ${makeToken('viewer-1')}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toMatch(/capture at least 3 usable items first/i);
    });
});
