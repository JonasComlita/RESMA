import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
    asRecord,
    normalizeSurface,
    parseNonNegativeInt,
    parseNonNegativeNumber,
    sanitizeString,
} from '../lib/ingestUtils.js';
import { authenticate } from '../middleware/authenticate.js';
import { createError } from '../middleware/errorHandler.js';
import { validateIngestPayload, type ValidatedFeedRequest } from '../middleware/validateIngestPayload.js';
import { packAndCompress } from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';
import {
    CURRENT_INGEST_VERSION,
} from '@resma/shared';
import { withDurableIngestIdempotency } from '../services/ingestIdempotency.js';
import { logIngestError, logIngestInfo } from '../services/ingestObservability.js';
import { getReplayKey, getUploadId, withIngestReplayGuard } from '../services/ingestReplayGuard.js';

const router: Router = Router();

// POST /twitter/feed - receive Twitter/X feed data batch
router.post('/feed', authenticate, validateIngestPayload({
    platform: 'twitter',
    routeLabel: '/twitter/feed',
}), async (req: ValidatedFeedRequest, res, next) => {
    try {
        const validPayload = req.validatedFeedPayload!;
        const incomingMetadata = asRecord(validPayload.sessionMetadata);
        const itemsToCreate = validPayload.feed.map((item: any, index: number) => {
            const metrics = asRecord(item.engagementMetrics);
            const likesCount = parseNonNegativeInt(metrics.likes ?? item.likes);
            const commentsCount = parseNonNegativeInt(metrics.comments ?? item.comments);
            const sharesCount = parseNonNegativeInt(metrics.shares ?? item.shares);
            const impressionDuration = parseNonNegativeNumber(
                metrics.impressionDuration ?? metrics.watchTime ?? item.watchDuration
            );
            const interactionType = sanitizeString(item.interactionType ?? metrics.interactionType);
            const contentCategories = new Set<string>();
            for (const category of Array.isArray(item.contentCategories) ? item.contentCategories : []) {
                const normalizedCategory = sanitizeString(category);
                if (normalizedCategory) {
                    contentCategories.add(normalizedCategory.toLowerCase());
                }
            }

            const isPromoted = Boolean(metrics.isPromoted) || contentCategories.has('promoted');
            if (isPromoted) {
                contentCategories.add('promoted');
            }

            const engagementMetrics = packAndCompress({
                impressionDuration,
                interactionType,
                isPromoted,
                likes: likesCount,
                comments: commentsCount,
                shares: sharesCount,
                views: parseNonNegativeNumber(metrics.views ?? item.views),
                timestamp: metrics.timestamp,
            }).data;

            return {
                videoId: item.videoId,
                creatorHandle: sanitizeString(item.creatorHandle),
                creatorId: sanitizeString(item.creatorId) ?? sanitizeString(item.creatorHandle),
                positionInFeed: parseNonNegativeInt(item.positionInFeed ?? item.position) ?? index,
                caption: sanitizeString(item.caption)?.substring(0, 500) ?? null,
                likesCount,
                commentsCount,
                sharesCount,
                engagementMetrics,
                contentCategories: Array.from(contentCategories.values()),
                watchDuration: impressionDuration ?? 0,
                interacted: Boolean(item.interacted),
                interactionType,
            };
        });

        if (itemsToCreate.length === 0) {
            return next(createError('Invalid feed item structure', 400));
        }

        const replayKey = getReplayKey(req, req.userId);
        const uploadId = getUploadId(req);
        const replayOutcome = await withIngestReplayGuard(replayKey, async () => {
            const durableOutcome = await withDurableIngestIdempotency({
                userId: req.userId!,
                uploadId,
                createSnapshot: async (tx) => {
                    const capturedAt = new Date();
                    const enrichedSessionMetadata = buildSessionQualityMetadata({
                        userId: req.userId!,
                        platform: 'twitter',
                        capturedAt,
                        feedItems: itemsToCreate.map((item: any) => ({
                            videoId: item.videoId,
                            positionInFeed: item.positionInFeed,
                        })),
                        existingMetadata: {
                            ...incomingMetadata,
                            type: sanitizeString(incomingMetadata.type) ?? 'TIMELINE_BATCH',
                            captureSurface: normalizeSurface(incomingMetadata.captureSurface, 'timeline'),
                            timestamp: Date.now(),
                            ingestVersion: CURRENT_INGEST_VERSION,
                        },
                    });

                    const snapshot = await tx.feedSnapshot.create({
                        data: {
                            userId: req.userId!,
                            platform: 'twitter',
                            capturedAt,
                            itemCount: itemsToCreate.length,
                            sessionMetadata: packAndCompress(enrichedSessionMetadata).data,
                            feedItems: {
                                create: itemsToCreate,
                            },
                        },
                        include: {
                            _count: { select: { feedItems: true } },
                        },
                    });

                    logIngestInfo('Twitter feed snapshot persisted', req, {
                        platform: 'twitter',
                        snapshotId: snapshot.id,
                        itemCount: itemsToCreate.length,
                    });

                    return {
                        snapshotId: snapshot.id,
                        value: {
                            statusCode: 201,
                            body: { success: true, snapshotId: snapshot.id },
                        },
                    };
                },
                onDuplicate: async (snapshotId) => ({
                    statusCode: 201,
                    body: { success: true, snapshotId },
                }),
            });

            if (durableOutcome.replayed) {
                logIngestInfo('Returned persisted /twitter/feed snapshot for duplicate upload id', req, {
                    platform: 'twitter',
                    snapshotId: durableOutcome.snapshotId,
                });
            }

            return durableOutcome.value;
        });

        if (replayOutcome.replayed) {
            logIngestInfo('Replayed prior /twitter/feed ingestion response', req, { platform: 'twitter' });
        }

        res.status(replayOutcome.response.statusCode).json(replayOutcome.response.body);
    } catch (err) {
        logIngestError('Unhandled /twitter/feed ingestion error', req, {
            error: err instanceof Error ? err.message : 'unknown-error',
        });
        console.error('Failed to save Twitter feed data:', err);
        return next(createError('Failed to save Twitter feed data', 500));
    }
});

export default router;
