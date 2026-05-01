import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ANALYSIS_RATE_LIMIT_MAX = '100';
process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = '60000';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        feedSnapshot: {
            findMany: vi.fn(),
            count: vi.fn(),
            findFirst: vi.fn(),
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
        },
        creator: {
            count: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const {
    analysisRouter,
    buildDiscoverFeed,
    scoreDiscoverRowsByPlatformPercentile,
} = await import('../src/routes/analysis.js');

function queryText(callIndex = 0) {
    const template = (prisma.$queryRaw as any).mock.calls[callIndex]?.[0] as TemplateStringsArray | undefined;
    return Array.from(template ?? []).join('?');
}

async function invokeAnalysisRoute(path: string, query: Record<string, string> = {}) {
    const layer = (analysisRouter as any).stack.find((candidate: any) => candidate.route?.path === path);
    if (!layer) throw new Error(`Route ${path} not found`);

    const handler = layer.route.stack.at(-1).handle;
    let payload: unknown;
    const req = { query };
    const res = {
        json(body: unknown) {
            payload = body;
            return res;
        },
    };
    const next = vi.fn((error?: unknown) => {
        if (error) throw error;
    });

    await handler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    return {
        status: 200,
        body: payload as any,
    };
}

describe('Discover platform-normalized ranking', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sorts all-platform rows by platform-relative percentile before raw appearances', () => {
        const feed = buildDiscoverFeed([
            {
                id: 'yt-mainstream',
                title: 'Large platform winner',
                creator: 'Creator Y',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T10:00:00.000Z'),
                appearances: 100,
            },
            {
                id: 'yt-runner-up',
                title: 'Large platform runner up',
                creator: 'Creator Y2',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T11:00:00.000Z'),
                appearances: 90,
            },
            {
                id: 'reddit-top',
                title: 'Small platform winner',
                creator: 'r/example',
                platform: 'reddit',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 3,
            },
            {
                id: 'reddit-bottom',
                title: 'Small platform baseline',
                creator: 'r/example',
                platform: 'reddit',
                timestamp: new Date('2026-04-30T08:00:00.000Z'),
                appearances: 1,
            },
        ], { allPlatforms: true });

        expect(feed.map((item) => item.id)).toEqual([
            'yt-mainstream',
            'reddit-top',
            'yt-runner-up',
            'reddit-bottom',
        ]);
        expect(feed.find((item) => item.id === 'reddit-top')).toMatchObject({
            normalizedScore: 1,
            rankingBasis: 'platform_percentile',
            contentFamily: 'community_post',
        });
    });

    it('keeps platform-filtered sorting appearance-based', () => {
        const feed = buildDiscoverFeed([
            {
                id: 'newer',
                title: 'Newer',
                creator: 'Creator',
                platform: 'tiktok',
                timestamp: new Date('2026-04-30T11:00:00.000Z'),
                appearances: 2,
            },
            {
                id: 'more-seen',
                title: 'More seen',
                creator: 'Creator',
                platform: 'tiktok',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 5,
            },
        ], { allPlatforms: false });

        expect(feed.map((item) => item.id)).toEqual(['more-seen', 'newer']);
        expect(feed[0]).toMatchObject({
            rankingBasis: 'appearances',
            appearances: 5,
            contentFamily: 'short_video',
        });
    });

    it('scores the same video id on different platforms as separate rows', () => {
        const scores = scoreDiscoverRowsByPlatformPercentile([
            {
                id: 'same-id',
                title: null,
                creator: null,
                platform: 'youtube',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 10,
            },
            {
                id: 'same-id',
                title: null,
                creator: null,
                platform: 'reddit',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 1,
            },
        ]);

        expect(scores.get('youtube:same-id')).toBe(1);
        expect(scores.get('reddit:same-id')).toBe(1);
    });

    it('returns normalized all-platform route results with new response fields', async () => {
        (prisma.$queryRaw as any).mockResolvedValueOnce([
            {
                id: 'yt-second',
                title: 'YouTube second',
                creator: 'Video Creator',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T10:00:00.000Z'),
                appearances: 10n,
            },
            {
                id: 'rd-first',
                title: 'Reddit first',
                creator: 'r/news',
                platform: 'reddit',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 2n,
            },
            {
                id: 'yt-first',
                title: 'YouTube first',
                creator: 'Video Creator',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T11:00:00.000Z'),
                appearances: 20n,
            },
        ] as any);

        const response = await invokeAnalysisRoute('/discover/popular');

        expect(response.status).toBe(200);
        expect(response.body.data.feed.map((item: { id: string }) => item.id)).toEqual([
            'yt-first',
            'rd-first',
            'yt-second',
        ]);
        expect(response.body.data.feed[1]).toMatchObject({
            appearances: 2,
            normalizedScore: 1,
            rankingBasis: 'platform_percentile',
            contentFamily: 'community_post',
        });
        expect(queryText()).toContain('GROUP BY fs."platform", fi."videoId"');
    });

    it('uses appearance ranking for platform-filtered route results', async () => {
        (prisma.$queryRaw as any).mockResolvedValueOnce([
            {
                id: 'older-more-seen',
                title: 'Older',
                creator: 'Creator',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T09:00:00.000Z'),
                appearances: 6n,
            },
            {
                id: 'newer-less-seen',
                title: 'Newer',
                creator: 'Creator',
                platform: 'youtube',
                timestamp: new Date('2026-04-30T11:00:00.000Z'),
                appearances: 2n,
            },
        ] as any);

        const response = await invokeAnalysisRoute('/discover/popular', { platform: 'youtube' });

        expect(response.status).toBe(200);
        expect(response.body.data.feed.map((item: { id: string }) => item.id)).toEqual([
            'older-more-seen',
            'newer-less-seen',
        ]);
        expect(response.body.data.feed[0]).toMatchObject({
            rankingBasis: 'appearances',
            appearances: 6,
        });
        expect(queryText()).toContain('GROUP BY fs."platform", fi."videoId"');
        expect(queryText()).toContain('ORDER BY appearances DESC, timestamp DESC');
    });

    it('keeps category filtering compatible with normalized all-platform ranking', async () => {
        (prisma.$queryRaw as any).mockResolvedValueOnce([]);

        const response = await invokeAnalysisRoute('/discover/popular', { category: 'news' });

        expect(response.status).toBe(200);
        expect(response.body.data.feed).toEqual([]);
        expect(queryText()).toContain('fi."contentCategories" @> ARRAY[');
        expect(queryText()).toContain('GROUP BY fs."platform", fi."videoId"');
    });

    it('counts categories by distinct platform and video pairs', async () => {
        (prisma.$queryRaw as any).mockResolvedValueOnce([
            { category: 'news', item_count: 2n },
        ] as any);

        const response = await invokeAnalysisRoute('/discover/categories');

        expect(response.status).toBe(200);
        expect(response.body.data.categories).toEqual([{ label: 'news', count: 2 }]);
        expect(queryText()).toContain('COUNT(DISTINCT (fs."platform", fi."videoId"))');
    });
});
