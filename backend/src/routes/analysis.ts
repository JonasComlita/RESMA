import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { findSimilarFeeds } from '../services/similarity.js';
import { generateFeedInsights, generateVideoInsights } from '../services/insights.js';
import {
    generateRecommendationMap,
    generateRecommendationMapForUsers,
    TraversalInputError,
} from '../services/recommendationTraversal.js';
import {
    AudienceForecastInputError,
    generateAudienceForecast,
    getCohortUserIds,
} from '../services/audienceForecast.js';
import { generateForecastEvaluation } from '../services/forecastEvaluation.js';
import {
    DataQualityInputError,
    generateDataQualityDiagnostics,
    generateDataQualityTrends,
} from '../services/dataQuality.js';
import { generateGoToMarketCohortBrief } from '../services/goToMarketBrief.js';

export const analysisRouter: Router = Router();
const MAX_SIMILAR_LIMIT = 20;

function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

// Get similar feeds/users with enhanced matching
analysisRouter.get('/similar', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const snapshotId = req.query.snapshotId as string;
        const requestedLimit = Math.max(1, parseInt(req.query.limit as string) || 10);
        const appliedLimit = Math.min(requestedLimit, MAX_SIMILAR_LIMIT);
        const startedAt = Date.now();

        const { similarFeeds, candidateCount } = await findSimilarFeeds(
            req.userId!,
            snapshotId,
            appliedLimit
        );
        const durationMs = Date.now() - startedAt;

        console.info('analysis.similar', {
            userId: req.userId,
            snapshotId: snapshotId || null,
            requestedLimit,
            appliedLimit,
            returned: similarFeeds.length,
            candidateCount,
            durationMs,
        });

        res.json({
            success: true,
            data: {
                similarFeeds,
                meta: {
                    requestedLimit,
                    appliedLimit,
                    truncated: requestedLimit > appliedLimit,
                    candidateCount,
                    durationMs,
                    privacyMode: 'aggregate-only',
                    source: 'observatory-cohorts',
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

// Build recommendation map by running BFS + DFS in parallel (internally)
analysisRouter.get('/recommendation-map', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const seedVideoId = String(req.query.seedVideoId || '').trim();
        if (!seedVideoId) {
            return res.status(400).json({
                success: false,
                error: 'seedVideoId is required',
            });
        }

        const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
        const maxNodesRaw = Number.parseInt(String(req.query.maxNodes || '40'), 10);
        const maxDepth = clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 8);
        const maxNodes = clampNumber(Number.isFinite(maxNodesRaw) ? maxNodesRaw : 40, 1, 300);
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const cohortId = String(req.query.cohortId || '').trim() || undefined;

        const map = cohortId
            ? await (async () => {
                const cohortUsers = await getCohortUserIds(platform, cohortId);
                return generateRecommendationMapForUsers(
                    cohortUsers,
                    {
                        seedVideoId,
                        maxDepth,
                        maxNodes,
                        platform,
                    },
                    { cohortId }
                );
            })()
            : await generateRecommendationMap(req.userId!, {
                seedVideoId,
                maxDepth,
                maxNodes,
                platform,
            });

        res.json({
            success: true,
            data: {
                map,
                meta: {
                    privacyMode: 'aggregate-only',
                    source: 'observatory-cohorts',
                },
            },
        });
    } catch (error) {
        if (error instanceof TraversalInputError || error instanceof AudienceForecastInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

        next(error);
    }
});

// Cohort-aware audience forecast (improves with more cross-user comparisons)
analysisRouter.get('/audience-forecast', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const targetVideoId = String(req.query.targetVideoId || '').trim();
        if (!targetVideoId) {
            return res.status(400).json({
                success: false,
                error: 'targetVideoId is required',
            });
        }

        const seedVideoId = String(req.query.seedVideoId || '').trim() || undefined;
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
        const beamWidthRaw = Number.parseInt(String(req.query.beamWidth || '30'), 10);
        const maxDepth = clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 6);
        const beamWidth = clampNumber(Number.isFinite(beamWidthRaw) ? beamWidthRaw : 30, 5, 120);

        const forecast = await generateAudienceForecast(req.userId!, {
            targetVideoId,
            seedVideoId,
            platform,
            maxDepth,
            beamWidth,
        });

        res.json({
            success: true,
            data: {
                forecast,
                meta: {
                    privacyMode: 'aggregate-only',
                    source: 'observatory-cohorts',
                },
            },
        });
    } catch (error) {
        if (error instanceof AudienceForecastInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

        next(error);
    }
});

// Aggregate creator-facing cohort brief export
analysisRouter.get('/go-to-market-brief', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const targetVideoId = String(req.query.targetVideoId || '').trim();
        if (!targetVideoId) {
            return res.status(400).json({
                success: false,
                error: 'targetVideoId is required',
            });
        }

        const seedVideoId = String(req.query.seedVideoId || '').trim() || undefined;
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const maxDepthRaw = Number.parseInt(String(req.query.maxDepth || '3'), 10);
        const beamWidthRaw = Number.parseInt(String(req.query.beamWidth || '30'), 10);
        const topCohortsRaw = Number.parseInt(String(req.query.topCohorts || '5'), 10);
        const maxPathsRaw = Number.parseInt(String(req.query.maxPathsPerCohort || '3'), 10);
        const pathBranchLimitRaw = Number.parseInt(String(req.query.pathBranchLimit || '6'), 10);

        const maxDepth = clampNumber(Number.isFinite(maxDepthRaw) ? maxDepthRaw : 3, 1, 6);
        const beamWidth = clampNumber(Number.isFinite(beamWidthRaw) ? beamWidthRaw : 30, 5, 120);
        const topCohorts = clampNumber(Number.isFinite(topCohortsRaw) ? topCohortsRaw : 5, 1, 12);
        const maxPathsPerCohort = clampNumber(Number.isFinite(maxPathsRaw) ? maxPathsRaw : 3, 1, 10);
        const pathBranchLimit = clampNumber(Number.isFinite(pathBranchLimitRaw) ? pathBranchLimitRaw : 6, 1, 25);

        const brief = await generateGoToMarketCohortBrief(req.userId!, {
            targetVideoId,
            seedVideoId,
            platform,
            maxDepth,
            beamWidth,
            topCohorts,
            maxPathsPerCohort,
            pathBranchLimit,
        });

        res.json({
            success: true,
            data: {
                brief,
                meta: {
                    privacyMode: 'aggregate-only',
                    source: 'observatory-cohorts',
                },
            },
        });
    } catch (error) {
        if (error instanceof AudienceForecastInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

        next(error);
    }
});

// Holdout evaluation for forecast reliability
analysisRouter.get('/forecast-evaluation', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const topKRaw = Number.parseInt(String(req.query.topK || '5'), 10);
        const topK = clampNumber(Number.isFinite(topKRaw) ? topKRaw : 5, 1, 20);

        const evaluation = await generateForecastEvaluation(platform, topK);

        res.json({
            success: true,
            data: { evaluation },
        });
    } catch (error) {
        if (error instanceof AudienceForecastInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

        next(error);
    }
});

// Data quality diagnostics for cross-user comparison reliability
analysisRouter.get('/data-quality', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const windowHoursRaw = Number.parseInt(String(req.query.windowHours || String(24 * 14)), 10);
        const windowHours = clampNumber(Number.isFinite(windowHoursRaw) ? windowHoursRaw : (24 * 14), 1, 24 * 180);

        const diagnostics = await generateDataQualityDiagnostics(platform, windowHours);

        res.json({
            success: true,
            data: { diagnostics },
        });
    } catch (error) {
        if (error instanceof DataQualityInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

        next(error);
    }
});

// Data quality trend points for drift monitoring
analysisRouter.get('/data-quality-trends', authenticate, async (req: AuthRequest, res, next) => {
    try {
        const platform = String(req.query.platform || 'youtube').toLowerCase();
        const windowHoursRaw = Number.parseInt(String(req.query.windowHours || String(24 * 14)), 10);
        const windowHours = clampNumber(Number.isFinite(windowHoursRaw) ? windowHoursRaw : (24 * 14), 1, 24 * 180);
        const bucketHoursRaw = Number.parseInt(String(req.query.bucketHours || '24'), 10);
        const bucketHours = clampNumber(Number.isFinite(bucketHoursRaw) ? bucketHoursRaw : 24, 1, windowHours);

        const trends = await generateDataQualityTrends(platform, windowHours, bucketHours);

        res.json({
            success: true,
            data: { trends },
        });
    } catch (error) {
        if (error instanceof DataQualityInputError) {
            return res.status(error.statusCode).json({
                success: false,
                error: error.message,
                details: error.details,
            });
        }

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
