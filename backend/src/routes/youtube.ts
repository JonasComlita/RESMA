import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';

const router = Router();

// POST /youtube/feed - receive YouTube feed data
router.post('/feed', authenticate, async (req: AuthRequest, res) => {
  const { feed } = req.body;

  if (!Array.isArray(feed) || feed.length === 0) {
    return res.status(400).json({ error: 'Invalid feed data' });
  }

  try {
    // Determine snapshot type based on first item
    const isHomePage = !feed[0].watchTime; // Heuristic: homepage items don't have watchTime initially

    // Serialize ad/recommendation data to MsgPack
    const itemsToCreate = feed.map((item: any, index: number) => {
      // Pack complex objects
      const engagementMetrics = packAndCompress({
        watchTime: item.watchTime,
        seekCount: item.seekCount,
        adEvents: item.adEvents,
        completed: item.completed,
        recommendations: item.recommendations,
        views: item.views,
        uploadDate: item.uploadDate
      }).data;

      return {
        videoId: item.videoId,
        // Channel info mapping
        creatorHandle: item.channelHandle || item.channelName, // Fallback
        creatorId: item.channelName, // Using name as ID proxy if needed, or null
        positionInFeed: item.position || index,
        caption: item.title, // Title maps to caption for now
        // Store rich data in the blob column
        engagementMetrics,
        contentCategories: item.tags || [],
        watchDuration: item.duration || 0
      };
    });

    const snapshot = await prisma.feedSnapshot.create({
      data: {
        userId: req.userId!,
        platform: 'youtube',
        itemCount: feed.length,
        sessionMetadata: packAndCompress({
          type: isHomePage ? 'HOMEPAGE_SNAPSHOT' : 'VIDEO_WATCH',
          timestamp: Date.now()
        }).data,
        feedItems: {
          create: itemsToCreate
        }
      },
      include: {
        _count: { select: { feedItems: true } }
      }
    });

    res.status(201).json({ success: true, snapshotId: snapshot.id });
  } catch (err) {
    console.error('Failed to save YouTube feed data:', err);
    res.status(500).json({ error: 'Failed to save YouTube feed data' });
  }
});

export default router;
