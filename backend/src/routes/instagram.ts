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

function parseNonNegativeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return 0;
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

function normalizeInstagramMediaId(raw: unknown): string | null {
    const value = sanitizeString(raw);
    if (!value) return null;

    let candidate = value;

    try {
        const parsed = new URL(value);
        const pathMatch = parsed.pathname.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,64})/);
        if (pathMatch?.[1]) {
            candidate = pathMatch[1];
        }
    } catch {
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

        const position = (parsePositiveInt(rec.position) ?? index) + 1;
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
                const videoId = normalizeInstagramMediaId(
                    item.videoId ?? item.id ?? item.postId ?? item.mediaId
                );
                if (!videoId) {
                    return null;
                }

                const recommendations = normalizeRecommendationRows(item.recommendations);
                const recommendationSurfaces = recommendationSurfaceCounts(recommendations);
                const watchTime = parseNonNegativeNumber(item.watchTime);
                const impressionDuration = parseNonNegativeNumber(item.impressionDuration);
                const watchDuration = Math.max(watchTime, impressionDuration);

                const engagementMetrics = packAndCompress({
                    watchTime,
                    impressionDuration,
                    loopCount: parsePositiveInt(item.loopCount) ?? 0,
                    isSponsored: Boolean(item.isSponsored),
                    recommendations,
                    recommendationSurfaceCounts: recommendationSurfaces,
                    recommendationCount: recommendations.length,
                    likes: parseNonNegativeNumber(item.likes),
                    comments: parseNonNegativeNumber(item.comments),
                    shares: parseNonNegativeNumber(item.shares),
                    views: parseNonNegativeNumber(item.views),
                    type: sanitizeString(item.type),
                }).data;

                const primaryType = sanitizeString(item.type);
                const categories = new Set<string>();
                if (primaryType) categories.add(primaryType.toLowerCase());
                if (Array.isArray(item.tags)) {
                    for (const tag of item.tags) {
                        const normalizedTag = sanitizeString(tag);
                        if (normalizedTag) categories.add(normalizedTag.toLowerCase());
                    }
                }

                return {
                    videoId,
                    creatorHandle: sanitizeString(item.author ?? item.username ?? item.creatorHandle),
                    creatorId: sanitizeString(item.author ?? item.username ?? item.creatorId),
                    positionInFeed: parsePositiveInt(item.position ?? item.positionInFeed) ?? index,
                    caption: sanitizeString(item.caption ?? item.title)?.slice(0, 500) ?? null,
                    engagementMetrics,
                    contentCategories: Array.from(categories.values()),
                    watchDuration,
                    interacted: Boolean(item.hasInteracted ?? item.interacted),
                    interactionType: sanitizeString(item.interactionType),
                };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item));

        if (itemsToCreate.length === 0) {
            return res.status(400).json({ error: 'Invalid feed item structure' });
        }

        const explicitType = sanitizeString(incomingMetadata.type);
        const hasWatchSignals = feed.some((item: any) => {
            const watchTime = parseNonNegativeNumber(item.watchTime) > 0;
            const recs = Array.isArray(item.recommendations) && item.recommendations.length > 0;
            return watchTime || recs;
        });

        const inferredType = explicitType || (hasWatchSignals ? 'REEL_WATCH' : 'INSTAGRAM_FEED_SNAPSHOT');
        const captureSurface = normalizeSurface(incomingMetadata.captureSurface ?? 'instagram-feed');

        const enrichedSessionMetadata = buildSessionQualityMetadata({
            userId: req.userId!,
            platform: 'instagram',
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
                ingestVersion: 'instagram-feed-v2',
            },
        });

        const snapshot = await prisma.feedSnapshot.create({
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

        res.status(201).json({ success: true, snapshotId: snapshot.id });
    } catch (err) {
        console.error('Failed to save Instagram feed data:', err);
        res.status(500).json({ error: 'Failed to save Instagram feed data' });
    }
});

export default router;
