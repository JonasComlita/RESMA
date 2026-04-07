import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticate, AuthRequest } from '../middleware/authenticate.js';
import { packAndCompress } from '../services/serialization.js';
import { buildSessionQualityMetadata } from '../services/snapshotQuality.js';

const router = Router();
const MAX_RECOMMENDATIONS_PER_ITEM = 40;

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
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

        const position = parsePositiveInt(rec.position) ?? index + 1;
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

router.post('/feed', authenticate, async (req: AuthRequest, res) => {
    const { feed, sessionMetadata } = req.body;

    if (!Array.isArray(feed) || feed.length === 0) {
        return res.status(400).json({ error: 'Invalid feed data' });
    }

    try {
        const capturedAt = new Date();
        const incomingMetadata = asRecord(sessionMetadata);

        const itemsToCreate = feed
            .map((item: any, index: number) => {
                const videoId = normalizeYouTubeVideoId(item.videoId);
                if (!videoId) {
                    return null;
                }

                const recommendations = normalizeRecommendationRows(item.recommendations);
                const recommendationSurfaces = recommendationSurfaceCounts(recommendations);

                const engagementMetrics = packAndCompress({
                    watchTime: item.watchTime,
                    seekCount: item.seekCount,
                    adEvents: item.adEvents,
                    completed: item.completed,
                    recommendations,
                    recommendationSurfaceCounts: recommendationSurfaces,
                    recommendationCount: recommendations.length,
                    views: item.views,
                    uploadDate: item.uploadDate,
                }).data;

                return {
                    videoId,
                    creatorHandle: sanitizeString(item.channelHandle) || sanitizeString(item.channelName),
                    creatorId: sanitizeString(item.channelName),
                    positionInFeed: parsePositiveInt(item.position) ?? index,
                    caption: sanitizeString(item.title),
                    engagementMetrics,
                    contentCategories: Array.isArray(item.tags)
                        ? item.tags
                            .map((tag: unknown) => sanitizeString(tag))
                            .filter((tag: string | null): tag is string => Boolean(tag))
                        : [],
                    watchDuration: typeof item.duration === 'number' && Number.isFinite(item.duration)
                        ? item.duration
                        : 0,
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        if (itemsToCreate.length === 0) {
            return res.status(400).json({ error: 'Invalid feed item structure' });
        }

        const explicitType = sanitizeString(incomingMetadata.type);
        const hasWatchSignals = feed.some((item: any) => {
            const watchTime = typeof item.watchTime === 'number' && Number.isFinite(item.watchTime);
            const adSignals = Array.isArray(item.adEvents) && item.adEvents.length > 0;
            const recommendations = Array.isArray(item.recommendations) && item.recommendations.length > 0;
            return watchTime || adSignals || recommendations;
        });

        const inferredType = explicitType || (hasWatchSignals ? 'VIDEO_WATCH' : 'HOMEPAGE_SNAPSHOT');
        const captureSurface = normalizeSurface(incomingMetadata.captureSurface);

        const enrichedSessionMetadata = buildSessionQualityMetadata({
            userId: req.userId!,
            platform: 'youtube',
            capturedAt,
            feedItems: itemsToCreate.map((item) => ({
                videoId: item.videoId,
                positionInFeed: item.positionInFeed,
            })),
            existingMetadata: {
                ...incomingMetadata,
                type: inferredType,
                captureSurface,
                timestamp: Date.now(),
                ingestVersion: 'youtube-feed-v2',
            },
        });

        const snapshot = await prisma.feedSnapshot.create({
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

        res.status(201).json({ success: true, snapshotId: snapshot.id });
    } catch (err) {
        console.error('Failed to save YouTube feed data:', err);
        res.status(500).json({ error: 'Failed to save YouTube feed data' });
    }
});

export default router;
