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
const MAX_RECOMMENDATIONS_PER_ITEM = 40;

function normalizeInstagramMediaId(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) return null;

    let candidate = value;

    try {
        const parsed = new URL(value);
        const storyMatch = parsed.pathname.match(/\/stories\/[^/]+\/(\d+)/);
        if (storyMatch?.[1]) {
            candidate = storyMatch[1];
        }
        const pathMatch = parsed.pathname.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,64})/);
        if (pathMatch?.[1]) {
            candidate = pathMatch[1];
        }
    } catch {
        const storyPathMatch = value.match(/\/stories\/[^/]+\/(\d+)/);
        if (storyPathMatch?.[1]) {
            candidate = storyPathMatch[1];
        }
        const directPathMatch = value.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,64})/);
        if (directPathMatch?.[1]) {
            candidate = directPathMatch[1];
        }
    }

    candidate = candidate.trim();
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(candidate)) {
        return null;
    }

    return candidate;
}

function normalizeRecommendationRows(rawRecommendations: unknown) {
    if (!Array.isArray(rawRecommendations)) {
        return [];
    }

    const deduped = new Map<string, {
        videoId: string;
        position: number;
        title: string | null;
        channel: string | null;
        surface: string;
        surfaces: Set<string>;
    }>();

    for (let index = 0; index < rawRecommendations.length; index += 1) {
        if (deduped.size >= MAX_RECOMMENDATIONS_PER_ITEM) {
            break;
        }

        const recommendation = rawRecommendations[index];
        if (!recommendation || typeof recommendation !== 'object') {
            continue;
        }

        const rec = recommendation as Record<string, unknown>;
        const videoId = normalizeInstagramMediaId(rec.videoId ?? rec.id ?? rec.postId ?? rec.mediaId ?? rec.url);
        if (!videoId) {
            continue;
        }

        const position = (parseNonNegativeInt(rec.position) ?? index) + 1;
        const title = sanitizeString(rec.title ?? rec.caption);
        const channel = sanitizeString(rec.channel ?? rec.author ?? rec.username);
        const primarySurface = normalizeSurface(rec.surface ?? rec.source ?? rec.placement);
        const rowSurfaces = new Set<string>([primarySurface]);

        if (Array.isArray(rec.surfaces)) {
            for (const surface of rec.surfaces) {
                rowSurfaces.add(normalizeSurface(surface));
            }
        }

        const existing = deduped.get(videoId);
        if (!existing) {
            deduped.set(videoId, {
                videoId,
                position,
                title,
                channel,
                surface: primarySurface,
                surfaces: rowSurfaces,
            });
            continue;
        }

        if (position < existing.position) {
            existing.position = position;
            existing.surface = primarySurface;
        }
        if (!existing.title && title) {
            existing.title = title;
        }
        if (!existing.channel && channel) {
            existing.channel = channel;
        }
        for (const surface of rowSurfaces) {
            existing.surfaces.add(surface);
        }
    }

    return Array.from(deduped.values())
        .sort((left, right) => left.position - right.position || left.videoId.localeCompare(right.videoId))
        .map((recommendation, index) => ({
            videoId: recommendation.videoId,
            position: index + 1,
            title: recommendation.title,
            channel: recommendation.channel,
            surface: recommendation.surface,
            surfaces: Array.from(recommendation.surfaces),
        }));
}

function recommendationSurfaceCounts(recommendations: Array<{ surface: string; surfaces: string[] }>) {
    const counts: Record<string, number> = {};

    for (const recommendation of recommendations) {
        const allSurfaces = new Set<string>([recommendation.surface, ...recommendation.surfaces]);
        for (const surface of allSurfaces) {
            counts[surface] = (counts[surface] ?? 0) + 1;
        }
    }

    return counts;
}

router.post('/feed', authenticate, validateIngestPayload({
    platform: 'instagram',
    routeLabel: '/instagram/feed',
}), async (req: ValidatedFeedRequest, res, next) => {
    try {
        const validPayload = req.validatedFeedPayload!;
        const incomingMetadata = asRecord(validPayload.sessionMetadata);
        const itemsToCreate = validPayload.feed
            .map((item: any, index: number) => {
                const videoId = normalizeInstagramMediaId(
                    item.videoId ?? item.id ?? item.postId ?? item.mediaId
                );
                if (!videoId) {
                    return null;
                }

                const metrics = asRecord(item.engagementMetrics);
                const recommendations = normalizeRecommendationRows(item.recommendations ?? metrics.recommendations);
                const recommendationSurfaces = recommendationSurfaceCounts(recommendations);
                const watchTime = parseNonNegativeNumber(metrics.watchTime ?? item.watchDuration ?? item.watchTime) ?? 0;
                const impressionDuration = parseNonNegativeNumber(metrics.impressionDuration ?? item.impressionDuration) ?? 0;
                const watchDuration = Math.max(watchTime, impressionDuration);
                const likesCount = parseNonNegativeInt(
                    metrics.likes ?? metrics.likesCount ?? item.likesCount ?? item.likes ?? item.likeCount
                );
                const commentsCount = parseNonNegativeInt(
                    metrics.comments ?? metrics.commentsCount ?? item.commentsCount ?? item.comments ?? item.commentCount
                );
                const sharesCount = parseNonNegativeInt(
                    metrics.shares ?? metrics.sharesCount ?? item.sharesCount ?? item.shares ?? item.shareCount
                );

                const engagementMetrics = packAndCompress({
                    watchTime,
                    impressionDuration,
                    loopCount: parseNonNegativeInt(metrics.loopCount ?? item.loopCount) ?? 0,
                    isSponsored: Boolean(metrics.isSponsored ?? item.isSponsored),
                    recommendations,
                    recommendationSurfaceCounts: recommendationSurfaces,
                    recommendationCount: recommendations.length,
                    likes: likesCount,
                    comments: commentsCount,
                    shares: sharesCount,
                    views: parseNonNegativeNumber(metrics.views ?? item.views),
                    type: sanitizeString(metrics.type ?? item.type),
                }).data;

                const primaryType = sanitizeString(metrics.type ?? item.type);
                const categories = new Set<string>();
                if (primaryType) categories.add(primaryType.toLowerCase());
                if (Array.isArray(item.contentCategories)) {
                    for (const category of item.contentCategories) {
                        const normalizedCategory = sanitizeString(category);
                        if (normalizedCategory) categories.add(normalizedCategory.toLowerCase());
                    }
                }
                if (Array.isArray(item.contentTags)) {
                    for (const tag of item.contentTags) {
                        const normalizedTag = sanitizeString(tag);
                        if (normalizedTag) categories.add(normalizedTag.toLowerCase());
                    }
                }

                return {
                    videoId,
                    creatorHandle: sanitizeString(item.creatorHandle ?? item.author ?? item.username),
                    creatorId: sanitizeString(item.creatorId ?? item.author ?? item.username),
                    positionInFeed: parseNonNegativeInt(item.position ?? item.positionInFeed) ?? index,
                    caption: sanitizeString(item.caption)?.slice(0, 500) ?? null,
                    likesCount,
                    commentsCount,
                    sharesCount,
                    engagementMetrics,
                    contentCategories: Array.from(categories.values()),
                    watchDuration,
                    interacted: Boolean(item.hasInteracted ?? item.interacted),
                    interactionType: sanitizeString(item.interactionType),
                };
            })
            .filter((item: any): item is NonNullable<typeof item> => Boolean(item));

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
                    const explicitType = sanitizeString(incomingMetadata.type);
                    const hasWatchSignals = validPayload.feed.some((item: any) => {
                        const metrics = asRecord(item.engagementMetrics);
                        const watchTime = parseNonNegativeNumber(item.watchDuration ?? metrics.watchTime) ?? 0;
                        const recs = Array.isArray(item.recommendations) && item.recommendations.length > 0;
                        return watchTime || recs;
                    });

                    const inferredType = explicitType || (hasWatchSignals ? 'REEL_WATCH' : 'INSTAGRAM_FEED_SNAPSHOT');
                    const captureSurface = normalizeSurface(incomingMetadata.captureSurface ?? 'instagram-feed');

                    const enrichedSessionMetadata = buildSessionQualityMetadata({
                        userId: req.userId!,
                        platform: 'instagram',
                        capturedAt,
                        feedItems: itemsToCreate.map((item: any) => ({
                            videoId: item.videoId,
                            positionInFeed: item.positionInFeed,
                        })),
                        existingMetadata: {
                            ...incomingMetadata,
                            type: inferredType,
                            captureSurface,
                            timestamp: Date.now(),
                            ingestVersion: CURRENT_INGEST_VERSION,
                        },
                    });

                    const snapshot = await tx.feedSnapshot.create({
                        data: {
                            userId: req.userId!,
                            platform: 'instagram',
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

                    logIngestInfo('Instagram feed snapshot persisted', req, {
                        platform: 'instagram',
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
                logIngestInfo('Returned persisted /instagram/feed snapshot for duplicate upload id', req, {
                    platform: 'instagram',
                    snapshotId: durableOutcome.snapshotId,
                });
            }

            return durableOutcome.value;
        });

        if (replayOutcome.replayed) {
            logIngestInfo('Replayed prior /instagram/feed ingestion response', req, { platform: 'instagram' });
        }

        res.status(replayOutcome.response.statusCode).json(replayOutcome.response.body);
    } catch (err) {
        logIngestError('Unhandled /instagram/feed ingestion error', req, {
            error: err instanceof Error ? err.message : 'unknown-error',
        });
        console.error('Failed to save Instagram feed data:', err);
        return next(createError('Failed to save Instagram feed data', 500));
    }
});

export default router;
