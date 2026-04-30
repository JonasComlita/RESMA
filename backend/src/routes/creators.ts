import { Router, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { prisma } from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { requirePremium } from '../middleware/requirePremium.js';

export const creatorsRouter: Router = Router();

const SUPPORTED_PLATFORMS = new Set(['tiktok', 'youtube', 'instagram', 'twitter']);

function sanitizeHandle(value: unknown): string {
    return String(value || '').trim().replace(/^@/, '');
}

function normalizePlatform(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_PLATFORMS.has(normalized) ? normalized : 'tiktok';
}

function platformHandleField(body: Record<string, unknown>) {
    if (typeof body.platformHandle === 'string' && body.platformHandle.trim().length > 0) {
        return sanitizeHandle(body.platformHandle);
    }
    if (typeof body.tiktokHandle === 'string' && body.tiktokHandle.trim().length > 0) {
        return sanitizeHandle(body.tiktokHandle);
    }
    return '';
}

// Claim a creator platform handle (platform-agnostic; backwards compatible with tiktokHandle)
creatorsRouter.post(
    '/claim',
    authenticate,
    requirePremium,
    [
        body('platform').optional().isIn(Array.from(SUPPORTED_PLATFORMS)),
        body('platformHandle')
            .optional()
            .trim()
            .matches(/^@?[\w.]+$/)
            .withMessage('Invalid platform handle format'),
        body('tiktokHandle')
            .optional()
            .trim()
            .matches(/^@?[\w.]+$/)
            .withMessage('Invalid TikTok handle format'),
    ],
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return next(createError(errors.array()[0].msg, 400));
            }

            const platform = normalizePlatform(req.body.platform);
            const platformHandle = platformHandleField(req.body ?? {});
            const platformAccountId = typeof req.body.platformAccountId === 'string'
                ? req.body.platformAccountId.trim()
                : null;

            if (!platformHandle) {
                return next(createError('platformHandle is required', 400));
            }

            const existingAccount = await prisma.platformAccount.findUnique({
                where: {
                    platform_platformHandle: {
                        platform,
                        platformHandle,
                    },
                },
                include: {
                    creator: {
                        select: { userId: true },
                    },
                },
            });

            if (existingAccount && existingAccount.creator.userId !== req.userId) {
                return next(createError('This handle is already claimed', 409));
            }

            let creator = await prisma.creator.findUnique({
                where: { userId: req.userId },
                include: { platformAccounts: true },
            });

            if (!creator) {
                creator = await prisma.creator.create({
                    data: {
                        userId: req.userId!,
                        verified: false,
                        platformAccounts: {
                            create: {
                                platform,
                                platformHandle,
                                platformAccountId: platformAccountId || null,
                            },
                        },
                    },
                    include: { platformAccounts: true },
                });
            } else {
                const existingCreatorAccount = creator.platformAccounts.find((account) => account.platform === platform);
                if (existingCreatorAccount && existingCreatorAccount.platformHandle !== platformHandle) {
                    return next(createError(`You already claimed a ${platform} account`, 409));
                }

                if (!existingCreatorAccount) {
                    creator = await prisma.creator.update({
                        where: { id: creator.id },
                        data: {
                            platformAccounts: {
                                create: {
                                    platform,
                                    platformHandle,
                                    platformAccountId: platformAccountId || null,
                                },
                            },
                        },
                        include: { platformAccounts: true },
                    });
                }
            }

            await prisma.user.update({
                where: { id: req.userId },
                data: { userType: 'CREATOR' },
            });

            const claimedAccount = creator.platformAccounts.find(
                (account) => account.platform === platform && account.platformHandle === platformHandle
            );

            res.status(201).json({
                success: true,
                data: {
                    creator,
                    platformAccount: claimedAccount ?? null,
                    message: 'Creator profile created. OAuth verification pending.',
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
            const platform = normalizePlatform(req.query.platform);
            const creator = await prisma.creator.findUnique({
                where: { userId: req.userId },
                include: { platformAccounts: true },
            });

            if (!creator) {
                return next(createError('Creator profile not found', 404));
            }

            const account = creator.platformAccounts.find((entry) => entry.platform === platform)
                ?? creator.platformAccounts[0];
            if (!account) {
                return next(createError(`No claimed ${platform} account found`, 404));
            }

            const [feedItems, viewerSnapshots] = await Promise.all([
                prisma.feedItem.findMany({
                    where: {
                        creatorHandle: account.platformHandle,
                        snapshot: {
                            platform: account.platform,
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
                }),
                prisma.feedSnapshot.findMany({
                    where: {
                        platform: account.platform,
                        user: {
                            contributeToCreatorInsights: true,
                            feedSnapshots: {
                                some: {
                                    platform: account.platform,
                                    feedItems: {
                                        some: {
                                            creatorHandle: account.platformHandle,
                                        },
                                    },
                                },
                            },
                        },
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
                })
            ]);

            const uniqueViewerIds = new Set(feedItems.map((item) => item.snapshot.userId));

            const creatorCounts: Record<string, number> = {};
            const categoryCounts: Record<string, number> = Object.create(null);

            for (const snapshot of viewerSnapshots) {
                for (const item of snapshot.feedItems) {
                    if (item.creatorHandle && item.creatorHandle !== account.platformHandle) {
                        creatorCounts[item.creatorHandle] = (creatorCounts[item.creatorHandle] || 0) + 1;
                    }
                    for (const cat of item.contentCategories) {
                        categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
                    }
                }
            }

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
                    platform: account.platform,
                    handle: account.platformHandle,
                    verified: creator.verified && account.verified,
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
            const platform = normalizePlatform(req.query.platform);
            const creator = await prisma.creator.findUnique({
                where: { userId: req.userId },
                include: { platformAccounts: true },
            });

            if (!creator) {
                return next(createError('Creator profile not found', 404));
            }

            const account = creator.platformAccounts.find((entry) => entry.platform === platform)
                ?? creator.platformAccounts[0];
            if (!account) {
                return next(createError(`No claimed ${platform} account found`, 404));
            }

            const reachStats = await prisma.creatorReach.findMany({
                where: {
                    creatorId: creator.id,
                    platform: account.platform,
                },
                orderBy: { date: 'desc' },
                take: 30,
            });

            res.json({
                success: true,
                data: {
                    platform: account.platform,
                    handle: account.platformHandle,
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
                platformAccounts: true,
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
