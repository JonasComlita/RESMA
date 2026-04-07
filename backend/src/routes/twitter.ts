import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';

const router: Router = Router();

function parseNonNegativeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.round(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return Math.round(parsed);
        }
    }
    return null;
}

// POST /twitter/feed - receive Twitter/X feed data batch
router.post('/feed', authenticate, async (req: AuthRequest, res) => {
    const { feed, sessionMetadata } = req.body;

    if (!Array.isArray(feed) || feed.length === 0) {
        return res.status(400).json({ error: 'Invalid feed data' });
    }

    try {
        const capturedAt = new Date();
        const itemsToCreate = feed.map((item: any, index: number) => {
            const likesCount = parseNonNegativeNumber(item.likes);
            const commentsCount = parseNonNegativeNumber(item.comments);
            const sharesCount = parseNonNegativeNumber(item.shares);

            // Pack metrics
            const engagementMetrics = packAndCompress({
                impressionDuration: item.impressionDuration,
                interactionType: item.interactionType,
                isPromoted: item.isPromoted,
                likes: likesCount,
                comments: commentsCount,
                shares: sharesCount,
                timestamp: item.timestamp
            }).data;

            return {
                videoId: item.id, // Using Tweet ID as "videoId" for schema reuse
                creatorHandle: item.authorHandle,
                creatorId: item.authorName, // Using name as ID proxy
                positionInFeed: index, // Batch index, not absolute, but sufficient
                caption: item.text ? item.text.substring(0, 500) : null,
                likesCount,
                commentsCount,
                sharesCount,
                engagementMetrics,
                contentCategories: item.isPromoted ? ['promoted'] : [],
                watchDuration: item.impressionDuration || 0,
                interacted: item.hasInteracted || false,
                interactionType: item.interactionType
            };
        });

        const enrichedSessionMetadata = buildSessionQualityMetadata({
            userId: req.userId!,
            platform: 'twitter',
            capturedAt,
            feedItems: itemsToCreate.map((item) => ({
                videoId: item.videoId,
                positionInFeed: item.positionInFeed,
            })),
            existingMetadata: {
                type: 'TIMELINE_BATCH',
                timestamp: Date.now(),
                ...(sessionMetadata && typeof sessionMetadata === 'object' ? sessionMetadata : {}),
            },
        });

        const snapshot = await prisma.feedSnapshot.create({
            data: {
                userId: req.userId!,
                platform: 'twitter',
                capturedAt,
                itemCount: feed.length,
                sessionMetadata: packAndCompress(enrichedSessionMetadata).data,
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
