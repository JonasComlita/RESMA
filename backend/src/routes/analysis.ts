import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { findSimilarFeeds } from '../services/similarity.js';
import { generateFeedInsights, generateVideoInsights } from '../services/insights.js';

export const analysisRouter = Router();

// Get similar feeds/users with enhanced matching
analysisRouter.get('/similar', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const snapshotId = req.query.snapshotId as string;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

        const similarFeeds = await findSimilarFeeds(req.userId!, snapshotId, limit);

        res.json({
            success: true,
            data: { similarFeeds },
        });
    } catch (error) {
        next(error);
    }
});

// Get "why am I seeing this" insights for a feed
analysisRouter.get('/insights/:snapshotId', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const { snapshotId } = req.params;

        const insights = await generateFeedInsights(req.userId!, snapshotId);

        res.json({
            success: true,
            data: { insights },
        });
    } catch (error) {
        next(error);
    }
});

// Get insights for a specific video
analysisRouter.get('/insights/video/:videoId', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const { videoId } = req.params;

        // Get the video
        const feedItem = await prisma.feedItem.findFirst({
            where: {
                videoId,
                snapshot: { userId: req.userId },
            },
        });

        if (!feedItem) {
            return res.json({
                success: true,
                data: {
                    insights: {
                        videoId,
                        reasons: [{ type: 'unknown', description: 'Video not found in your feeds', confidence: 0 }],
                    },
                },
            });
        }

        const reasons = await generateVideoInsights(req.userId!, videoId, feedItem.creatorHandle);

        res.json({
            success: true,
            data: {
                insights: {
                    videoId,
                    creatorHandle: feedItem.creatorHandle,
                    reasons,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// Get global statistics
analysisRouter.get('/stats', async (req, res, next) => {
    try {
        const [
            totalUsers,
            totalSnapshots,
            totalFeedItems,
            totalCreators,
            recentSnapshots,
        ] = await Promise.all([
            prisma.user.count(),
            prisma.feedSnapshot.count(),
            prisma.feedItem.count(),
            prisma.creator.count({ where: { verified: true } }),
            prisma.feedSnapshot.count({
                where: {
                    capturedAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    },
                },
            }),
        ]);

        res.json({
            success: true,
            data: {
                stats: {
                    totalUsers,
                    totalSnapshots,
                    totalFeedItems,
                    totalCreators,
                    recentSnapshots,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// Get top creators from all feeds
analysisRouter.get('/top-creators', async (req, res, next) => {
    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

        const topCreators = await prisma.feedItem.groupBy({
            by: ['creatorHandle'],
            where: {
                creatorHandle: { not: null },
            },
            _count: { creatorHandle: true },
            orderBy: { _count: { creatorHandle: 'desc' } },
            take: limit,
        });

        res.json({
            success: true,
            data: {
                creators: topCreators.map((c) => ({
                    handle: c.creatorHandle,
                    appearances: c._count.creatorHandle,
                })),
            },
        });
    } catch (error) {
        next(error);
    }
});

// Get user's algorithm profile summary
analysisRouter.get('/profile', authenticate, async (req: AuthRequest, res, next) => {
    try {
        // Get all user's feed items
        const feedItems = await prisma.feedItem.findMany({
            where: {
                snapshot: { userId: req.userId },
            },
            select: {
                creatorHandle: true,
                contentCategories: true,
            },
            take: 500,
        });

        // Calculate category breakdown
        const categoryCounts: Record<string, number> = {};
        const creatorCounts: Record<string, number> = {};

        for (const item of feedItems) {
            for (const cat of item.contentCategories) {
                categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
            }
            if (item.creatorHandle) {
                creatorCounts[item.creatorHandle] = (creatorCounts[item.creatorHandle] || 0) + 1;
            }
        }

        const total = feedItems.length || 1;

        // Convert to percentages and sort
        const categoryBreakdown = Object.entries(categoryCounts)
            .map(([category, count]) => ({
                category,
                count,
                percentage: Math.round((count / total) * 100),
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const topCreators = Object.entries(creatorCounts)
            .map(([handle, count]) => ({ handle, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        res.json({
            success: true,
            data: {
                profile: {
                    totalVideosAnalyzed: feedItems.length,
                    categoryBreakdown,
                    topCreators,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});
