import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';
import {
    coercePlatformFeedPayload,
    CURRENT_INGEST_VERSION,
    getFeedItemLimitError,
} from '@resma/shared';
import { withDurableIngestIdempotency } from '../services/ingestIdempotency.js';
import { logIngestError, logIngestInfo, logIngestWarn } from '../services/ingestObservability.js';
import { getReplayKey, getUploadId, withIngestReplayGuard } from '../services/ingestReplayGuard.js';

const router: Router = Router();

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function normalizeSurface(surface: unknown): string {
    const raw = sanitizeString(surface);
    if (!raw) return 'timeline';

    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    return normalized.length > 0 ? normalized.slice(0, 48) : 'timeline';
}

function parseNonNegativeInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.round(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return null;
}

function parseNonNegativeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return null;
}

// POST /twitter/feed - receive Twitter/X feed data batch
router.post('/feed', authenticate, async (req: AuthRequest, res) => {
    try {
        const feedLimitError = getFeedItemLimitError({
            feed: req.body?.feed,
            items: req.body?.items,
        });
        if (feedLimitError) {
            logIngestWarn('Feed item limit exceeded for /twitter/feed', req, {
                reason: feedLimitError,
            });
            return res.status(400).json({ error: feedLimitError });
        }

        const validPayload = coercePlatformFeedPayload({
            platform: 'twitter',
            feed: req.body?.feed,
            sessionMetadata: req.body?.sessionMetadata,
        }, {
            expectedPlatform: 'twitter',
            requireFullFeedValidity: true,
        });
        if (!validPayload) {
            logIngestWarn('Contract validation failed for /twitter/feed', req, {
                reason: 'payload failed shared contract coercion',
            });
            return res.status(400).json({ error: 'Payload failed contract validation' });
        }

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
            return res.status(400).json({ error: 'Invalid feed item structure' });
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
                            captureSurface: normalizeSurface(incomingMetadata.captureSurface),
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
        res.status(500).json({ error: 'Failed to save Twitter feed data' });
    }
});

export default router;
