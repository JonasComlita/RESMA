import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { requirePremium } from '../middleware/requirePremium.js';

export const creatorsRouter = Router();

// Claim a TikTok handle (initiate OAuth flow)
creatorsRouter.post(
    '/claim',
    authenticate,
    requirePremium,
    [
        body('tiktokHandle')
            .trim()
            .matches(/^@?[\w.]+$/)
            .withMessage('Invalid TikTok handle format'),
    ],
    async (req: AuthRequest, res, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            let { tiktokHandle } = req.body;

            // Normalize handle (remove @ if present)
            tiktokHandle = tiktokHandle.replace(/^@/, '');

            // Check if handle is already claimed
            const existing = await prisma.creator.findUnique({
                where: { tiktokHandle },
            });

            if (existing) {
                return next(createError('This handle is already claimed', 409));
            }

            // Check if user already has a creator profile
            const userCreator = await prisma.creator.findUnique({
                where: { userId: req.userId },
            });

            if (userCreator) {
                return next(createError('You already have a creator profile', 409));
            }

            // Create pending creator profile (will be verified via OAuth)
            const creator = await prisma.creator.create({
                data: {
                    userId: req.userId!,
                    tiktokHandle,
                    verified: false,
                },
            });

            // Update user type
            await prisma.user.update({
                where: { id: req.userId },
                data: { userType: 'CREATOR' },
            });

            // In a real implementation, redirect to TikTok OAuth
            // For now, return success with instructions
            res.status(201).json({
                success: true,
                data: {
                    creator,
                    message: 'Creator profile created. OAuth verification pending.',
                    // In production: oauthUrl: generateTikTokOAuthUrl(creator.id)
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get creator's audience insights
creatorsRouter.get(
    '/me/audience',
    authenticate,
    requirePremium,
    async (req: AuthRequest, res, next) => {
        try {
            const creator = await prisma.creator.findUnique({
                where: { userId: req.userId },
            });

            if (!creator) {
                return next(createError('Creator profile not found', 404));
            }

            // Get all feed items that feature this creator
            // Only from users who have opted in to contribute
            const feedItems = await prisma.feedItem.findMany({
                where: {
                    creatorHandle: creator.tiktokHandle,
                    snapshot: {
                        user: {
                            contributeToCreatorInsights: true,
                        },
                    },
                },
                include: {
                    snapshot: {
                        include: {
                            user: {
                                select: { id: true },
                            },
                        },
                    },
                },
            });

            // Calculate unique viewers
            const uniqueViewerIds = new Set(
                feedItems.map((item) => item.snapshot.userId)
            );

            // Aggregate content categories from viewers' other feed items
            const viewerSnapshots = await prisma.feedSnapshot.findMany({
                where: {
                    userId: { in: Array.from(uniqueViewerIds) },
                },
                include: {
                    feedItems: {
                        select: {
                            creatorHandle: true,
                            contentCategories: true,
                        },
                    },
                },
                take: 100,
            });

            // Build audience profile
            const creatorCounts: Record<string, number> = {};
            const categoryCounts: Record<string, number> = {};

            for (const snapshot of viewerSnapshots) {
                for (const item of snapshot.feedItems) {
                    if (item.creatorHandle && item.creatorHandle !== creator.tiktokHandle) {
                        creatorCounts[item.creatorHandle] = (creatorCounts[item.creatorHandle] || 0) + 1;
                    }
                    for (const cat of item.contentCategories) {
                        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
                    }
                }
            }

            // Sort and limit
            const topCreators = Object.entries(creatorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([handle, count]) => ({ handle, count }));

            const topCategories = Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([category, count]) => ({ category, count }));

            res.json({
                success: true,
                data: {
                    handle: creator.tiktokHandle,
                    verified: creator.verified,
                    audience: {
                        uniqueViewers: uniqueViewerIds.size,
                        totalImpressions: feedItems.length,
                        otherCreatorsTheyWatch: topCreators,
                        contentInterests: topCategories,
                    },
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get reach over time
creatorsRouter.get(
    '/me/reach',
    authenticate,
    requirePremium,
    async (req: AuthRequest, res, next) => {
        try {
            const creator = await prisma.creator.findUnique({
                where: { userId: req.userId },
            });

            if (!creator) {
                return next(createError('Creator profile not found', 404));
            }

            const reachStats = await prisma.creatorReach.findMany({
                where: { creatorId: creator.id },
                orderBy: { date: 'desc' },
                take: 30,
            });

            res.json({
                success: true,
                data: {
                    handle: creator.tiktokHandle,
                    reachHistory: reachStats,
                },
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get creator profile
creatorsRouter.get('/me', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const creator = await prisma.creator.findUnique({
            where: { userId: req.userId },
            include: {
                _count: {
                    select: { reachStats: true },
                },
            },
        });

        if (!creator) {
            return res.json({
                success: true,
                data: { creator: null },
            });
        }

        res.json({
            success: true,
            data: { creator },
        });
    } catch (error) {
        next(error);
    }
});
