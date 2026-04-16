import { prisma } from '../lib/prisma.js';
import { packAndCompress } from './serialization.js';

// Save YouTube feed data to the database
export async function saveYouTubeFeedData(feed: any[], userId?: string) {
  if (!Array.isArray(feed) || feed.length === 0) return;
  // Create FeedSnapshot
  const snapshot = await prisma.feedSnapshot.create({
    data: {
      userId: userId || 'anonymous', // Replace with real userId if available
      platform: 'youtube',
      itemCount: feed.length,
      feedItems: {
        create: feed.map((item: any) => ({
          videoId: item.videoId || '',
          creatorHandle: item.channel || null,
          positionInFeed: item.position || 0,
          caption: item.title || null,
          likesCount: typeof item.likes === 'number' ? Math.round(item.likes) : null,
          commentsCount: typeof item.comments === 'number' ? Math.round(item.comments) : null,
          sharesCount: typeof item.shares === 'number' ? Math.round(item.shares) : null,
          engagementMetrics: packAndCompress({
            views: item.views,
            thumbnail: item.thumbnail,
          }).data,
          contentTags: Array.isArray(item.tags) ? item.tags : [],
          contentCategories: [],
        })),
      },
    },
  });
  return snapshot;
}
