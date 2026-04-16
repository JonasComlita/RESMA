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
const MAX_RECOMMENDATIONS_PER_ITEM = 40;

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function parseNonNegativeInt(value: unknown): number | null {
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

function normalizeSurface(surface: unknown): string {
    const raw = sanitizeString(surface);
    if (!raw) return 'unknown';

    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    return normalized.length > 0 ? normalized.slice(0, 48) : 'unknown';
}

function normalizeYouTubeVideoId(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) return null;

    let candidate = value;

    try {
        const parsed = new URL(candidate);
        const queryId = parsed.searchParams.get('v');
        if (queryId) {
            candidate = queryId;
        } else {
            const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,20})/);
            if (shortsMatch?.[1]) {
                candidate = shortsMatch[1];
            } else if (parsed.hostname.includes('youtu.be')) {
                candidate = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
            }
        }
    } catch {
        if (candidate.includes('v=')) {
            candidate = candidate.split('v=')[1]?.split('&')[0] || candidate;
        }
    }

    candidate = candidate.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(candidate)) {
        return null;
    }

    return candidate;
}

export function normalizeYouTubeCreatorHandle(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) {
        return null;
    }

    try {
        const parsed = new URL(value, 'https://www.youtube.com');
        const handleMatch = parsed.pathname.match(/\/@([A-Za-z0-9._-]+)/);
        if (handleMatch?.[1]) {
            return handleMatch[1];
        }
    } catch {
        // Fall through to raw string normalization below.
    }

    const normalized = value.trim().replace(/^\/+/, '').replace(/^@/, '');
    return /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : null;
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
        const videoId = normalizeYouTubeVideoId(rec.videoId);
        if (!videoId) {
            continue;
        }

        const position = parseNonNegativeInt(rec.position) ?? index + 1;
        const title = sanitizeString(rec.title);
        const channel = sanitizeString(rec.channel);

        const rowSurfaces = new Set<string>();
        const primarySurface = normalizeSurface(rec.surface ?? rec.source ?? rec.placement);
        rowSurfaces.add(primarySurface);

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

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

export function deriveYouTubeCreatorIdentity(item: Record<string, unknown>) {
    const rawHandle = sanitizeString(item.creatorHandle) ?? sanitizeString(item.channelHandle);
    const normalizedHandle = normalizeYouTubeCreatorHandle(rawHandle);
    return {
        creatorHandle: normalizedHandle ?? rawHandle ?? sanitizeString(item.channelName),
        creatorId: sanitizeString(item.creatorId) ?? normalizedHandle ?? sanitizeString(item.channelName),
    };
}

export function hasYouTubeWatchSignals(item: unknown): boolean {
    const record = asRecord(item);
    const metrics = asRecord(record.engagementMetrics);
    const watchTime = parseNonNegativeNumber(record.watchDuration ?? metrics.watchTime);
    const adSignals = Array.isArray(metrics.adEvents) && metrics.adEvents.length > 0;
    const recommendations = Array.isArray(record.recommendations)
        ? record.recommendations
        : (Array.isArray(metrics.recommendations) ? metrics.recommendations : []);
    return Boolean(watchTime && watchTime > 0) || adSignals || recommendations.length > 0;
}

router.post('/feed', authenticate, async (req: AuthRequest, res) => {
    try {
        const feedLimitError = getFeedItemLimitError({
            feed: req.body?.feed,
            items: req.body?.items,
        });
        if (feedLimitError) {
            logIngestWarn('Feed item limit exceeded for /youtube/feed', req, {
                reason: feedLimitError,
            });
            return res.status(400).json({ error: feedLimitError });
        }

        const validPayload = coercePlatformFeedPayload({
            platform: 'youtube',
            feed: req.body?.feed,
            sessionMetadata: req.body?.sessionMetadata,
        }, {
            expectedPlatform: 'youtube',
            requireFullFeedValidity: true,
        });
        if (!validPayload) {
            logIngestWarn('Contract validation failed for /youtube/feed', req, {
                reason: 'payload failed shared contract coercion',
            });
            return res.status(400).json({ error: 'Payload failed contract validation' });
        }

        const incomingMetadata = asRecord(validPayload.sessionMetadata);
        const itemsToCreate = validPayload.feed
            .map((item: any, index: number) => {
                const videoId = normalizeYouTubeVideoId(item.videoId);
                if (!videoId) {
                    return null;
                }

                const metrics = asRecord(item.engagementMetrics);
                const recommendations = normalizeRecommendationRows(item.recommendations ?? metrics.recommendations);
                const recommendationSurfaces = recommendationSurfaceCounts(recommendations);
                const likesCount = parseNonNegativeInt(metrics.likes ?? item.likes ?? item.likeCount);
                const commentsCount = parseNonNegativeInt(metrics.comments ?? item.comments ?? item.commentCount);
                const sharesCount = parseNonNegativeInt(metrics.shares ?? item.shares ?? item.shareCount);
                const watchTime = parseNonNegativeNumber(metrics.watchTime ?? item.watchDuration ?? item.watchTime);
                const watchDuration = parseNonNegativeNumber(item.watchDuration ?? watchTime) ?? 0;
                const rawCategories = Array.isArray(item.contentCategories)
                    ? item.contentCategories
                    : Array.isArray(item.contentTags)
                        ? item.contentTags
                        : (Array.isArray(item.tags) ? item.tags : []);
                const creatorIdentity = deriveYouTubeCreatorIdentity(item);

                const engagementMetrics = packAndCompress({
                    watchTime,
                    seekCount: parseNonNegativeInt(metrics.seekCount ?? item.seekCount),
                    adEvents: metrics.adEvents ?? item.adEvents,
                    completed: metrics.completed ?? item.completed,
                    recommendations,
                    recommendationSurfaceCounts: recommendationSurfaces,
                    recommendationCount: recommendations.length,
                    likes: likesCount,
                    comments: commentsCount,
                    shares: sharesCount,
                    views: metrics.views ?? item.views,
                    uploadDate: metrics.uploadDate ?? item.uploadDate,
                }).data;

                return {
                    videoId,
                    creatorHandle: creatorIdentity.creatorHandle,
                    creatorId: creatorIdentity.creatorId,
                    positionInFeed: parseNonNegativeInt(item.positionInFeed ?? item.position) ?? index,
                    caption: sanitizeString(item.caption ?? item.title),
                    likesCount,
                    commentsCount,
                    sharesCount,
                    engagementMetrics,
                    contentCategories: rawCategories
                        .map((tag: unknown) => sanitizeString(tag))
                        .filter((tag: string | null): tag is string => Boolean(tag))
                        .slice(0, 20),
                    watchDuration,
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

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
                    const explicitType = sanitizeString(incomingMetadata.type);
                    const hasWatchSignals = validPayload.feed.some((item: any) => hasYouTubeWatchSignals(item));

                    const inferredType = explicitType || (hasWatchSignals ? 'VIDEO_WATCH' : 'HOMEPAGE_SNAPSHOT');
                    const captureSurface = normalizeSurface(incomingMetadata.captureSurface);

                    const enrichedSessionMetadata = buildSessionQualityMetadata({
                        userId: req.userId!,
                        platform: 'youtube',
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
                            platform: 'youtube',
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

                    logIngestInfo('YouTube feed snapshot persisted', req, {
                        platform: 'youtube',
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
                logIngestInfo('Returned persisted /youtube/feed snapshot for duplicate upload id', req, {
                    platform: 'youtube',
                    snapshotId: durableOutcome.snapshotId,
                });
            }

            return durableOutcome.value;
        });

        if (replayOutcome.replayed) {
            logIngestInfo('Replayed prior /youtube/feed ingestion response', req, { platform: 'youtube' });
        }

        res.status(replayOutcome.response.statusCode).json(replayOutcome.response.body);
    } catch (err) {
        logIngestError('Unhandled /youtube/feed ingestion error', req, {
            error: err instanceof Error ? err.message : 'unknown-error',
        });
        console.error('Failed to save YouTube feed data:', err);
        res.status(500).json({ error: 'Failed to save YouTube feed data' });
    }
});

export default router;
