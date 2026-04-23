import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ANALYTICS_DATASET_CACHE_TTL_MS = '60000';
process.env.ANALYTICS_MATERIALIZED_CACHE_TTL_MS = '60000';
process.env.ANALYTICS_EVALUATION_CACHE_TTL_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            aggregate: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const {
    generateAudienceForecast,
    resetAudienceForecastMaterializationForTests,
} = await import('../src/services/audienceForecast.js');
const {
    resetAudienceFeedItemsCacheForTests,
} = await import('../src/services/audienceForecastLoader.js');
const {
    generateForecastEvaluation,
    resetForecastEvaluationCacheForTests,
} = await import('../src/services/forecastEvaluation.js');

const jsonMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

function makeForecastSnapshots() {
    return [
        {
            id: 'snap-1',
            userId: 'u1',
            capturedAt: new Date('2026-04-01T00:00:00.000Z'),
            sessionMetadata: null,
            feedItems: [
                {
                    videoId: 'seed',
                    creatorHandle: 'creatorA',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
                    positionInFeed: 0,
                },
                {
                    videoId: 'target',
                    creatorHandle: 'creatorB',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([]),
                    positionInFeed: 1,
                },
                {
                    videoId: 'side-1',
                    creatorHandle: 'creatorC',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([]),
                    positionInFeed: 2,
                },
            ],
        },
        {
            id: 'snap-2',
            userId: 'u2',
            capturedAt: new Date('2026-04-01T01:00:00.000Z'),
            sessionMetadata: null,
            feedItems: [
                {
                    videoId: 'seed',
                    creatorHandle: 'creatorA',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
                    positionInFeed: 0,
                },
                {
                    videoId: 'target',
                    creatorHandle: 'creatorD',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([]),
                    positionInFeed: 1,
                },
                {
                    videoId: 'side-2',
                    creatorHandle: 'creatorE',
                    contentCategories: ['gaming'],
                    engagementMetrics: jsonMetrics([]),
                    positionInFeed: 2,
                },
            ],
        },
    ];
}

function makeEvaluationSnapshots() {
    const sourceIdFor = (index: number) => `s${String(index).padStart(10, '0')}`;
    const targetIdFor = (index: number) => `t${String(index).padStart(10, '0')}`;
    const sideIdFor = (index: number) => `x${String(index).padStart(10, '0')}`;

    return Array.from({ length: 12 }, (_, index) => ({
        userId: `u${index + 1}`,
        capturedAt: new Date(`2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
        feedItems: [
            {
                videoId: sourceIdFor(index),
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: targetIdFor(index), position: 1 }]),
            },
            {
                videoId: targetIdFor(index),
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                videoId: sideIdFor(index),
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
        ],
    }));
}

describe('Analytics caching', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetAudienceFeedItemsCacheForTests();
        resetAudienceForecastMaterializationForTests();
        resetForecastEvaluationCacheForTests();
    });

    it('reuses cached audience forecast inputs across repeated forecast requests', async () => {
        vi.mocked(prisma.feedSnapshot.aggregate).mockResolvedValue({
            _count: { _all: 2 },
            _max: { capturedAt: new Date('2026-04-01T01:00:00.000Z') },
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(makeForecastSnapshots() as any);

        const first = await generateAudienceForecast('u1', {
            targetVideoId: 'target',
            seedVideoId: 'seed',
            platform: 'youtube',
            maxDepth: 3,
            beamWidth: 30,
        });
        const second = await generateAudienceForecast('u1', {
            targetVideoId: 'target',
            seedVideoId: 'seed',
            platform: 'youtube',
            maxDepth: 3,
            beamWidth: 30,
        });

        expect(first.targetVideoId).toBe('target');
        expect(second.targetVideoId).toBe('target');
        expect(prisma.feedSnapshot.findMany).toHaveBeenCalledTimes(1);
    });

    it('reuses cached holdout evaluation results while the snapshot watermark is unchanged', async () => {
        vi.mocked(prisma.feedSnapshot.aggregate).mockResolvedValue({
            _count: { _all: 12 },
            _max: { capturedAt: new Date('2026-04-12T00:00:00.000Z') },
        } as any);
        vi.mocked(prisma.feedSnapshot.findMany).mockResolvedValue(makeEvaluationSnapshots() as any);

        const first = await generateForecastEvaluation('youtube', 5);
        const second = await generateForecastEvaluation('youtube', 5);

        expect(first.platform).toBe('youtube');
        expect(second.platform).toBe('youtube');
        expect(prisma.feedSnapshot.findMany).toHaveBeenCalledTimes(1);
    });
});
