import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { anonymizeSnapshot } from '../services/anonymizer.js';

export const feedsRouter = Router();

// Submit a new feed snapshot
feedsRouter.post(
    '/',
    authenticate,
    [
        body('items').isArray({ min: 1 }).withMessage('Feed items required'),
        body('items.*.videoId').notEmpty().withMessage('Video ID required'),
        body('items.*.positionInFeed').isInt({ min: 0 }).withMessage('Position required'),
    ],
    async (req: AuthRequest, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const { items, sessionMetadata } = req.body;

            // Anonymize the data
            const anonymizedItems = items.map(anonymizeSnapshot);

            // Create snapshot with items
            const snapshot = await prisma.feedSnapshot.create({
                data: {
                    userId: req.userId!,
                    platform: 'tiktok',
                    itemCount: items.length,
                    sessionMetadata,
                    feedItems: {
                        create: anonymizedItems.map((item: any, index: number) => ({
                            videoId: item.videoId,
                            creatorId: item.creatorId,
                            creatorHandle: item.creatorHandle,
                            positionInFeed: item.positionInFeed ?? index,
                            caption: item.caption?.substring(0, 500),
                            musicId: item.musicId,
                            musicTitle: item.musicTitle,
                            engagementMetrics: item.engagementMetrics,
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

            res.status(201).json({
                success: true,
                data: { snapshot },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get user's feed snapshots
feedsRouter.get('/', authenticate, async (req: AuthRequest, res, next) => {
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

        res.json({
            success: true,
            data: {
                snapshots,
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
feedsRouter.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
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

        res.json({
            success: true,
            data: { snapshot },
        });
    } catch (error) {
        next(error);
    }
});

// Delete a snapshot
feedsRouter.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
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
