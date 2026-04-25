import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
    prisma: {
        feedSnapshot: {
            findFirst: vi.fn(),
        },
        feedItem: {
            count: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
        },
    },
}));

const { prisma } = await import('../src/lib/prisma.js');
const { generateFeedInsights } = await import('../src/services/insights.js');

describe('generateFeedInsights', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('batches feed-level insight queries instead of querying per feed item', async () => {
        vi.mocked(prisma.feedSnapshot.findFirst).mockResolvedValue({
            id: 'snapshot-1',
            feedItems: [
                {
                    videoId: 'video-1',
                    creatorHandle: 'creator-a',
                    positionInFeed: 1,
                    contentCategories: ['comedy'],
                },
                {
                    videoId: 'video-2',
                    creatorHandle: 'creator-b',
                    positionInFeed: 2,
                    contentCategories: ['education'],
                },
                {
                    videoId: 'video-3',
                    creatorHandle: 'creator-a',
                    positionInFeed: 3,
                    contentCategories: ['comedy'],
                },
            ],
        } as any);
        vi.mocked(prisma.feedItem.findMany)
            .mockResolvedValueOnce([
                { contentCategories: ['comedy'] },
                { contentCategories: ['comedy'] },
                { contentCategories: ['comedy'] },
                { contentCategories: ['comedy'] },
            ] as any)
            .mockResolvedValueOnce([
                { creatorHandle: 'creator-a', videoId: 'video-older' },
                { creatorHandle: 'creator-a', videoId: 'video-1' },
                { creatorHandle: 'creator-b', videoId: 'video-other' },
            ] as any);

        const insights = await generateFeedInsights('user-1', 'snapshot-1');

        expect(prisma.feedItem.findMany).toHaveBeenCalledTimes(2);
        expect(prisma.feedItem.count).not.toHaveBeenCalled();
        expect(prisma.feedItem.findFirst).not.toHaveBeenCalled();
        expect(insights).toHaveLength(3);
        expect(insights[0].reasons.map((reason) => reason.type)).toContain('creator_affinity');
        expect(insights[0].reasons.map((reason) => reason.type)).toContain('content_category');
    });
});
