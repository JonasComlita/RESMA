import { prisma } from '../lib/prisma.js';
import { anonymizeSnapshot } from './anonymizer.js';

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
            contentTags: Array.isArray(item.hashtags) ? item.hashtags : [],
            contentCategories: [],
        };
        return anonymizeSnapshot(base);
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
