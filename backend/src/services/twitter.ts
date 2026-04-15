import { prisma } from '../lib/prisma.js';
import { anonymizeSnapshot } from './anonymizer.js';
import { packAndCompress } from './serialization.js';

// Save Twitter feed data to the database
export async function saveTwitterFeedData(feed: any[], userId?: string) {
    if (!Array.isArray(feed) || feed.length === 0) return;
    // Anonymize and transform feed items
    const items = feed.map((item: any, idx: number) => {
        const base = {
            videoId: item.tweetId || '',
            creatorHandle: item.username || null,
            positionInFeed: item.position || idx,
            caption: item.text || null,
            engagementMetrics: {
                likes: item.likes,
                retweets: item.retweets,
                replies: item.replies,
            },
            likesCount: typeof item.likes === 'number' ? Math.round(item.likes) : null,
            commentsCount: typeof item.replies === 'number' ? Math.round(item.replies) : null,
            sharesCount: typeof item.retweets === 'number' ? Math.round(item.retweets) : null,
            contentTags: Array.isArray(item.hashtags) ? item.hashtags : [],
            contentCategories: [],
        };
        const sanitized = anonymizeSnapshot(base);
        return {
            ...sanitized,
            likesCount: typeof item.likes === 'number' ? Math.round(item.likes) : null,
            commentsCount: typeof item.replies === 'number' ? Math.round(item.replies) : null,
            sharesCount: typeof item.retweets === 'number' ? Math.round(item.retweets) : null,
            positionInFeed: sanitized.positionInFeed ?? idx,
            engagementMetrics: packAndCompress(sanitized.engagementMetrics || {}).data,
        };
    });
    // Create FeedSnapshot
    const snapshot = await prisma.feedSnapshot.create({
        data: {
            userId: userId || 'anonymous',
            platform: 'twitter',
            itemCount: items.length,
            feedItems: {
                create: items,
            },
        },
    });
    return snapshot;
}
