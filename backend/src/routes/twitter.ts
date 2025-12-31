import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';

const router = Router();

// POST /twitter/feed - receive Twitter/X feed data batch
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
                interactionType: item.interactionType,
                isPromoted: item.isPromoted,
                timestamp: item.timestamp
            }).data;

            return {
                videoId: item.id, // Using Tweet ID as "videoId" for schema reuse
                creatorHandle: item.authorHandle,
                creatorId: item.authorName, // Using name as ID proxy
                positionInFeed: index, // Batch index, not absolute, but sufficient
                caption: item.text ? item.text.substring(0, 500) : null,
                engagementMetrics,
                contentCategories: item.isPromoted ? ['promoted'] : [],
                watchDuration: item.impressionDuration || 0,
                interacted: item.hasInteracted || false,
                interactionType: item.interactionType
            };
        });

        const snapshot = await prisma.feedSnapshot.create({
            data: {
                userId: req.userId!,
                platform: 'twitter',
                itemCount: feed.length,
                sessionMetadata: packAndCompress({
                    type: 'TIMELINE_BATCH',
                    timestamp: Date.now()
                }).data,
                feedItems: {
                    create: itemsToCreate
                }
            }
        });

        res.status(201).json({ success: true, snapshotId: snapshot.id });
    } catch (err) {
        console.error('Failed to save Twitter feed data:', err);
        res.status(500).json({ error: 'Failed to save Twitter feed data' });
    }
});

export default router;
