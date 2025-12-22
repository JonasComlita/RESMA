import { prisma } from '../lib/prisma.js';

// Save Instagram feed data to the database
export async function saveInstagramFeedData(feed: any[], userId?: string) {
  if (!Array.isArray(feed) || feed.length === 0) return;
  // Create FeedSnapshot
  const snapshot = await prisma.feedSnapshot.create({
    data: {
      userId: userId || 'anonymous', // Replace with real userId if available
      platform: 'instagram',
      itemCount: feed.length,
      feedItems: {
        create: feed.map((item: any) => ({
          videoId: item.postId || '',
          creatorHandle: item.username || null,
          positionInFeed: item.position || 0,
          caption: item.caption || null,
          engagementMetrics: {
            likes: item.likes,
            comments: item.comments,
            thumbnail: item.thumbnail,
          },
          contentTags: Array.isArray(item.tags) ? item.tags : [],
          contentCategories: [],
        })),
      },
    },
  });
  return snapshot;
}
