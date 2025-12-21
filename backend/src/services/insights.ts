/**
 * Algorithm Insights Service
 * Generates "Why am I seeing this?" explanations
 */

import { prisma } from '../lib/prisma.js';

interface InsightReason {
    type: 'creator_affinity' | 'content_category' | 'engagement_pattern' | 'trending';
    description: string;
    confidence: number; // 0-1
    details?: any;
}

interface FeedInsights {
    videoId: string;
    reasons: InsightReason[];
    similarTo: string[]; // Other videos this is similar to
}

/**
 * Detect content categories from caption and hashtags
 */
export function detectCategories(caption: string | null, tags: string[]): string[] {
    const categories: string[] = [];
    const text = `${caption || ''} ${tags.join(' ')}`.toLowerCase();

    const categoryPatterns: Record<string, string[]> = {
        'comedy': ['funny', 'comedy', 'joke', 'lol', 'humor', 'meme', 'prank'],
        'dance': ['dance', 'dancing', 'choreography', 'moves', 'tiktokdance'],
        'music': ['music', 'song', 'singing', 'cover', 'musician', 'beat'],
        'beauty': ['makeup', 'beauty', 'skincare', 'grwm', 'tutorial', 'cosmetic'],
        'fashion': ['fashion', 'outfit', 'style', 'ootd', 'clothing', 'fit'],
        'food': ['food', 'recipe', 'cooking', 'foodtok', 'asmr', 'eating', 'mukbang'],
        'fitness': ['fitness', 'workout', 'gym', 'exercise', 'health', 'gains'],
        'gaming': ['game', 'gaming', 'gamer', 'twitch', 'esports', 'playthrough'],
        'education': ['learn', 'education', 'tutorial', 'howto', 'tips', 'hack'],
        'pets': ['pet', 'dog', 'cat', 'animal', 'puppy', 'kitten', 'cute'],
        'travel': ['travel', 'vacation', 'trip', 'explore', 'destination'],
        'lifestyle': ['lifestyle', 'dayinmylife', 'vlog', 'routine', 'life'],
        'news': ['news', 'politics', 'current', 'breaking', 'update'],
        'sports': ['sports', 'basketball', 'football', 'soccer', 'athlete'],
    };

    for (const [category, keywords] of Object.entries(categoryPatterns)) {
        if (keywords.some((kw) => text.includes(kw))) {
            categories.push(category);
        }
    }

    return categories.length > 0 ? categories : ['general'];
}

/**
 * Generate insights for why a video appears in a user's feed
 */
export async function generateVideoInsights(
    userId: string,
    videoId: string,
    creatorHandle: string | null
): Promise<InsightReason[]> {
    const reasons: InsightReason[] = [];

    if (!creatorHandle) {
        return [{ type: 'trending', description: 'Trending content', confidence: 0.5 }];
    }

    // Check creator affinity (have they seen this creator before?)
    const previousViews = await prisma.feedItem.count({
        where: {
            creatorHandle,
            snapshot: { userId },
            videoId: { not: videoId },
        },
    });

    if (previousViews > 0) {
        reasons.push({
            type: 'creator_affinity',
            description: `You've seen ${previousViews} other videos from @${creatorHandle}`,
            confidence: Math.min(0.9, 0.5 + previousViews * 0.1),
            details: { previousViews, creatorHandle },
        });
    }

    // Check content category patterns
    const userCategories = await prisma.feedItem.findMany({
        where: {
            snapshot: { userId },
            contentCategories: { isEmpty: false },
        },
        select: { contentCategories: true },
        take: 100,
    });

    // Count category frequencies
    const categoryCounts: Record<string, number> = {};
    for (const item of userCategories) {
        for (const cat of item.contentCategories) {
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
    }

    // Get this video's categories
    const thisVideo = await prisma.feedItem.findFirst({
        where: { videoId },
        select: { contentCategories: true },
    });

    if (thisVideo?.contentCategories) {
        const matchingCategories = thisVideo.contentCategories.filter(
            (cat) => categoryCounts[cat] && categoryCounts[cat] > 3
        );

        if (matchingCategories.length > 0) {
            reasons.push({
                type: 'content_category',
                description: `Based on your interest in ${matchingCategories.join(', ')} content`,
                confidence: 0.7,
                details: { categories: matchingCategories },
            });
        }
    }

    // If no specific reasons found, mark as algorithmic discovery
    if (reasons.length === 0) {
        reasons.push({
            type: 'trending',
            description: 'Recommended to help you discover new content',
            confidence: 0.4,
        });
    }

    return reasons;
}

/**
 * Generate insights for an entire feed snapshot
 */
export async function generateFeedInsights(
    userId: string,
    snapshotId: string
): Promise<FeedInsights[]> {
    const snapshot = await prisma.feedSnapshot.findFirst({
        where: { id: snapshotId, userId },
        include: {
            feedItems: {
                orderBy: { positionInFeed: 'asc' },
            },
        },
    });

    if (!snapshot) {
        return [];
    }

    const insights: FeedInsights[] = [];

    for (const item of snapshot.feedItems) {
        const reasons = await generateVideoInsights(
            userId,
            item.videoId,
            item.creatorHandle
        );

        insights.push({
            videoId: item.videoId,
            reasons,
            similarTo: [], // Could be populated with similar videos
        });
    }

    return insights;
}
