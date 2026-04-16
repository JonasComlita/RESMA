import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { anonymizeSnapshot } from '../services/anonymizer.js';
import {
    coercePlatformFeedPayload,
    CURRENT_INGEST_VERSION,
    getFeedItemLimitError,
} from '@resma/shared';
import {
    packAndCompress,
    decompressAndUnpack,
    isCompressedMsgpack
} from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';
import { withDurableIngestIdempotency } from '../services/ingestIdempotency.js';
import { logIngestError, logIngestInfo, logIngestWarn } from '../services/ingestObservability.js';
import { getReplayKey, getUploadId, withIngestReplayGuard } from '../services/ingestReplayGuard.js';

export const feedsRouter: Router = Router();
const GENERIC_FEEDS_PLATFORM = 'tiktok';

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
function deserializeMetadata<T>(
    data: Buffer | null,
    snapshotId: string,
    field: 'sessionMetadata' | 'engagementMetrics'
): T | null {
    if (!data) return null;
    if (isCompressedMsgpack(data)) {
        return decompressAndUnpack<T>(data);
    }
    try {
        return JSON.parse(data.toString('utf-8')) as T;
    } catch (error) {
        console.warn('Failed to parse legacy snapshot metadata', {
            snapshotId,
            field,
            error: error instanceof Error ? error.message : 'unknown-error',
        });
        return null;
    }
}

/**
 * Transform snapshot for API response (decompress binary fields)
 */
function transformSnapshotForResponse(snapshot: any) {
    return {
        ...snapshot,
        sessionMetadata: deserializeMetadata(snapshot.sessionMetadata, snapshot.id, 'sessionMetadata'),
        feedItems: snapshot.feedItems?.map((item: any) => ({
            ...item,
            engagementMetrics: deserializeMetadata(item.engagementMetrics, snapshot.id, 'engagementMetrics'),
        })),
    };
}

async function findSnapshotResponse(snapshotId: string, userId: string) {
    const snapshot = await prisma.feedSnapshot.findUnique({
        where: { id: snapshotId },
        include: {
            feedItems: {
                orderBy: { positionInFeed: 'asc' },
            },
            _count: { select: { feedItems: true } },
        },
    });

    if (!snapshot || snapshot.userId !== userId) {
        throw new Error(`Snapshot ${snapshotId} not found for duplicate upload replay`);
    }

    return {
        success: true,
        data: {
            snapshot: transformSnapshotForResponse(snapshot),
        },
    };
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.round(value));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.round(parsed));
        }
    }
    return null;
}

// Submit a new feed snapshot
feedsRouter.post(
    '/',
    authenticate,
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        try {
            const requestedPlatform = typeof req.body?.platform === 'string'
                ? req.body.platform.trim().toLowerCase()
                : null;
            if (requestedPlatform && requestedPlatform !== GENERIC_FEEDS_PLATFORM) {
                logIngestWarn('Contract validation failed for /feeds', req, {
                    reason: 'payload requested explicit platform outside the /feeds tiktok gateway',
                });
                return next(createError('Payload failed contract validation', 400));
            }

            const feedLimitError = getFeedItemLimitError(req.body);
            if (feedLimitError) {
                logIngestWarn('Feed item limit exceeded for /feeds', req, {
                    reason: feedLimitError,
                });
                return next(createError(feedLimitError, 400));
            }

            const validPayload = coercePlatformFeedPayload(req.body, {
                expectedPlatform: GENERIC_FEEDS_PLATFORM,
                requireFullFeedValidity: true,
            });
            if (!validPayload) {
                logIngestWarn('Contract validation failed for /feeds', req, {
                    reason: 'payload failed shared contract coercion',
                });
                return next(createError('Payload failed contract validation', 400));
            }

            const platform = GENERIC_FEEDS_PLATFORM;
            const replayKey = getReplayKey(req, req.userId);
            const uploadId = getUploadId(req);
            const replayOutcome = await withIngestReplayGuard(replayKey, async () => {
                const durableOutcome = await withDurableIngestIdempotency({
                    userId: req.userId!,
                    uploadId,
                    createSnapshot: async (tx) => {
                        const capturedAt = new Date();

                        const anonymizedItems = validPayload.feed.map((item: any, index: number) => {
                            const safePosition = Number.isFinite(item.positionInFeed)
                                ? item.positionInFeed
                                : Number.isFinite(item.position)
                                    ? item.position
                                    : index;

                            const normalizedEngagementMetrics = item.engagementMetrics && typeof item.engagementMetrics === 'object'
                                ? item.engagementMetrics
                                : {
                                    likes: item.likes,
                                    comments: item.comments,
                                    shares: item.shares,
                                    views: item.views,
                                    watchTime: item.watchTime,
                                    recommendations: Array.isArray(item.recommendations) ? item.recommendations : [],
                                };

                            return anonymizeSnapshot({
                                videoId: item.videoId,
                                creatorId: item.creatorId,
                                creatorHandle: item.creatorHandle,
                                caption: item.caption,
                                musicId: item.musicId,
                                musicTitle: item.musicTitle,
                                engagementMetrics: normalizedEngagementMetrics,
                                contentTags: item.contentTags || [],
                                watchDuration: item.watchDuration,
                                interacted: item.interacted || false,
                                interactionType: item.interactionType,
                                positionInFeed: safePosition,
                            });
                        });

                        const enrichedSessionMetadata = buildSessionQualityMetadata({
                            userId: req.userId!,
                            platform,
                            capturedAt,
                            feedItems: anonymizedItems.map((item: any, index: number) => ({
                                videoId: item.videoId,
                                positionInFeed: item.positionInFeed ?? index,
                            })),
                            existingMetadata: {
                                ...validPayload.sessionMetadata,
                                ingestVersion: CURRENT_INGEST_VERSION,
                            },
                        });

                        const snapshot = await tx.feedSnapshot.create({
                            data: {
                                userId: req.userId!,
                                platform,
                                capturedAt,
                                itemCount: validPayload.feed.length,
                                sessionMetadata: serializeMetadata(enrichedSessionMetadata),
                                feedItems: {
                                    create: anonymizedItems.map((item: any, index: number) => {
                                        const likesCount = asNumber(item.engagementMetrics?.likes);
                                        const commentsCount = asNumber(item.engagementMetrics?.comments);
                                        const sharesCount = asNumber(item.engagementMetrics?.shares);

                                        return {
                                            videoId: item.videoId,
                                            creatorId: item.creatorId,
                                            creatorHandle: item.creatorHandle,
                                            positionInFeed: item.positionInFeed ?? index,
                                            caption: item.caption?.substring(0, 500),
                                            musicId: item.musicId,
                                            musicTitle: item.musicTitle,
                                            likesCount,
                                            commentsCount,
                                            sharesCount,
                                            engagementMetrics: serializeMetadata(item.engagementMetrics),
                                            contentTags: item.contentTags || [],
                                            contentCategories: item.contentCategories || [],
                                            watchDuration: item.watchDuration,
                                            interacted: item.interacted || false,
                                            interactionType: item.interactionType,
                                        };
                                    }),
                                },
                            },
                            include: {
                                feedItems: true,
                                _count: { select: { feedItems: true } },
                            },
                        });

                        logIngestInfo('Feed snapshot persisted', req, {
                            platform,
                            snapshotId: snapshot.id,
                            itemCount: validPayload.feed.length,
                        });

                        return {
                            snapshotId: snapshot.id,
                            value: {
                                statusCode: 201,
                                body: {
                                    success: true,
                                    data: {
                                        snapshot: transformSnapshotForResponse(snapshot),
                                    },
                                },
                            },
                        };
                    },
                    onDuplicate: async (snapshotId) => ({
                        statusCode: 201,
                        body: await findSnapshotResponse(snapshotId, req.userId!),
                    }),
                });

                if (durableOutcome.replayed) {
                    logIngestInfo('Returned persisted /feeds snapshot for duplicate upload id', req, {
                        platform,
                        snapshotId: durableOutcome.snapshotId,
                    });
                }

                return durableOutcome.value;
            });

            if (replayOutcome.replayed) {
                logIngestInfo('Replayed prior /feeds ingestion response', req, { platform });
            }

            res.status(replayOutcome.response.statusCode).json(replayOutcome.response.body);
        } catch (error) {
            logIngestError('Unhandled /feeds ingestion error', req, {
                error: error instanceof Error ? error.message : 'unknown-error',
            });
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
            sessionMetadata: deserializeMetadata(s.sessionMetadata, s.id, 'sessionMetadata'),
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
