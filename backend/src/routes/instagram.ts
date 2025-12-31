import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';

const router = Router();

// POST /instagram/feed - receive Instagram feed/reel data
router.post('/feed', authenticate, async (req: AuthRequest, res) => {
  const { feed } = req.body;

  if (!Array.isArray(feed) || feed.length === 0) {
    return res.status(400).json({ error: 'Invalid feed data' });
  }

  try {
    const itemsToCreate = feed.map((item: any, index: number) => {
      // Pack metrics
      const engagementMetrics = packAndCompress({
        impressionDuration: item.impressionDuration,
        watchTime: item.watchTime,
        isSponsored: item.isSponsored,
        type: item.type,
        timestamp: item.timestamp
      }).data;

      return {
        videoId: item.id, // Post/Reel ID
        creatorHandle: item.author, // Might be null for Reels if not extracted
        creatorId: item.author,
        positionInFeed: index,
        caption: item.caption ? item.caption.substring(0, 500) : null,
        engagementMetrics,
        contentCategories: item.type ? [item.type] : [], // 'reel' or 'image'
        watchDuration: item.watchTime || item.impressionDuration || 0,
        interacted: item.hasInteracted || false,
        interactionType: item.interactionType
      };
    });

    const snapshot = await prisma.feedSnapshot.create({
      data: {
        userId: req.userId!,
        platform: 'instagram',
        itemCount: feed.length,
        sessionMetadata: packAndCompress({
          type: 'INSTAGRAM_SESSION',
          timestamp: Date.now()
        }).data,
        feedItems: {
          create: itemsToCreate
        }
      }
    });

    res.status(201).json({ success: true, snapshotId: snapshot.id });
  } catch (err) {
    console.error('Failed to save Instagram feed data:', err);
    res.status(500).json({ error: 'Failed to save Instagram feed data' });
  }
});

export default router;
