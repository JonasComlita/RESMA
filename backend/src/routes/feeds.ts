import { Router, Response, NextFunction } from 'express';
import { body, query, validationResult } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { anonymizeSnapshot } from '../services/anonymizer.js';
import {
    packAndCompress,
    decompressAndUnpack,
    isCompressedMsgpack
} from '../services/serialization.js';

export const feedsRouter = Router();

/**
 * Helper to serialize metadata to compressed MessagePack
 */
function serializeMetadata(data: any): Buffer | null {
    if (!data) return null;
    return packAndCompress(data).data;
}

/**
 * Helper to deserialize metadata from compressed MessagePack or legacy JSON
 */
function deserializeMetadata<T>(data: Buffer | null): T | null {
    if (!data) return null;
    if (isCompressedMsgpack(data)) {
        return decompressAndUnpack<T>(data);
    }
    // Legacy: try parsing as JSON string (shouldn't happen with new schema)
    return JSON.parse(data.toString('utf-8')) as T;
}

/**
 * Transform snapshot for API response (decompress binary fields)
 */
function transformSnapshotForResponse(snapshot: any) {
    return {
        ...snapshot,
        sessionMetadata: deserializeMetadata(snapshot.sessionMetadata),
        feedItems: snapshot.feedItems?.map((item: any) => ({
            ...item,
            engagementMetrics: deserializeMetadata(item.engagementMetrics),
        })),
    };
}

// Submit a new feed snapshot
feedsRouter.post(
    '/',
    authenticate,
    [
        body('items').isArray({ min: 1 }).withMessage('Feed items required'),
        body('items.*.videoId').notEmpty().withMessage('Video ID required'),
        body('items.*.positionInFeed').isInt({ min: 0 }).withMessage('Position required'),
    ],
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const { items, sessionMetadata } = req.body;

            // Anonymize the data
            const anonymizedItems = items.map(anonymizeSnapshot);

            // Serialize sessionMetadata to compressed MessagePack
            const compressedSessionMetadata = serializeMetadata(sessionMetadata);

            // Create snapshot with items
            const snapshot = await prisma.feedSnapshot.create({
                data: {
                    userId: req.userId!,
                    platform: 'tiktok',
                    itemCount: items.length,
                    sessionMetadata: compressedSessionMetadata,
                    feedItems: {
                        create: anonymizedItems.map((item: any, index: number) => ({
                            videoId: item.videoId,
                            creatorId: item.creatorId,
                            creatorHandle: item.creatorHandle,
                            positionInFeed: item.positionInFeed ?? index,
                            caption: item.caption?.substring(0, 500),
                            musicId: item.musicId,
                            musicTitle: item.musicTitle,
                            // Serialize engagementMetrics to compressed MessagePack
                            engagementMetrics: serializeMetadata(item.engagementMetrics),
                            contentTags: item.contentTags || [],
                            watchDuration: item.watchDuration,
                            interacted: item.interacted || false,
                            interactionType: item.interactionType,
                        })),
                    },
                },
                include: {
                    feedItems: true,
                    _count: { select: { feedItems: true } },
                },
            });

            // Transform response (decompress for client)
            const responseSnapshot = transformSnapshotForResponse(snapshot);

            res.status(201).json({
                success: true,
                data: { snapshot: responseSnapshot },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get user's feed snapshots
feedsRouter.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
        const skip = (page - 1) * limit;

        const [snapshots, total] = await Promise.all([
            prisma.feedSnapshot.findMany({
                where: { userId: req.userId },
                orderBy: { capturedAt: 'desc' },
                skip,
                take: limit,
                include: {
                    _count: { select: { feedItems: true } },
                },
            }),
            prisma.feedSnapshot.count({ where: { userId: req.userId } }),
        ]);

        // Transform snapshots (decompress sessionMetadata)
        const transformedSnapshots = snapshots.map(s => ({
            ...s,
            sessionMetadata: deserializeMetadata(s.sessionMetadata),
        }));

        res.json({
            success: true,
            data: {
                snapshots: transformedSnapshots,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// Get single snapshot with items
feedsRouter.get('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const snapshot = await prisma.feedSnapshot.findFirst({
            where: {
                id: req.params.id,
                userId: req.userId,
            },
            include: {
                feedItems: {
                    orderBy: { positionInFeed: 'asc' },
                },
            },
        });

        if (!snapshot) {
            return next(createError('Snapshot not found', 404));
        }

        // Transform response (decompress all binary fields)
        const responseSnapshot = transformSnapshotForResponse(snapshot);

        res.json({
            success: true,
            data: { snapshot: responseSnapshot },
        });
    } catch (error) {
        next(error);
    }
});

// Delete a snapshot
feedsRouter.delete('/:id', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const snapshot = await prisma.feedSnapshot.findFirst({
            where: {
                id: req.params.id,
                userId: req.userId,
            },
        });

        if (!snapshot) {
            return next(createError('Snapshot not found', 404));
        }

        await prisma.feedSnapshot.delete({
            where: { id: req.params.id },
        });

        res.json({
            success: true,
            message: 'Snapshot deleted',
        });
    } catch (error) {
        next(error);
    }
});
