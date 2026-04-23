/**
 * Anonymization service for feed data
 * Strips or hashes PII before storage
 */
import { sanitizeString } from '../lib/ingestUtils.js';

interface FeedItemInput {
    videoId: string;
    creatorId?: string;
    creatorHandle?: string;
    caption?: string;
    musicId?: string;
    musicTitle?: string;
    engagementMetrics?: Record<string, any>;
    contentTags?: string[];
    contentCategories?: string[];
    watchDuration?: number;
    interacted?: boolean;
    interactionType?: string;
    positionInFeed?: number;
}

function sanitizeRecommendationRows(recommendations: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(recommendations)) {
        return [];
    }

    const rows: Array<Record<string, unknown>> = [];

    for (let index = 0; index < recommendations.length; index += 1) {
        const recommendation = recommendations[index];
        if (!recommendation || typeof recommendation !== 'object') {
            continue;
        }

        const record = recommendation as Record<string, unknown>;
        const videoId = sanitizeString(record.videoId ?? record.id ?? record.postId ?? record.url);
        if (!videoId) {
            continue;
        }

        const positionRaw = typeof record.position === 'number'
            ? record.position
            : Number.parseInt(String(record.position ?? index + 1), 10);
        const position = Number.isFinite(positionRaw) ? Math.max(1, Math.round(positionRaw)) : (index + 1);

        const surface = sanitizeString(record.surface ?? record.source ?? record.placement) ?? 'unknown';
        const surfaces = Array.isArray(record.surfaces)
            ? record.surfaces
                .map((entry) => sanitizeString(entry))
                .filter((entry): entry is string => Boolean(entry))
                .slice(0, 6)
            : [];

        rows.push({
            videoId,
            position,
            title: sanitizeString(record.title),
            channel: sanitizeString(record.channel ?? record.author ?? record.username),
            surface,
            surfaces,
        });
    }

    return rows.slice(0, 40);
}

/**
 * Anonymize a single feed item
 * - Keep video/music IDs (public identifiers)
 * - Keep creator handles (public)
 * - Truncate long captions
 * - Remove any potential PII from engagement metrics
 */
export function anonymizeSnapshot(item: FeedItemInput): FeedItemInput {
    const cleaned = { ...item };

    // Truncate caption to prevent any sensitive data
    if (cleaned.caption && cleaned.caption.length > 500) {
        cleaned.caption = cleaned.caption.substring(0, 500) + '...';
    }

    // Clean engagement metrics - only keep numeric values
    if (cleaned.engagementMetrics) {
        const safeMetrics: Record<string, unknown> = {};
        const allowedNumericKeys = [
            'likes',
            'comments',
            'shares',
            'views',
            'plays',
            'watchTime',
            'impressionDuration',
            'duration',
            'watchedSeconds',
            'loops',
            'loopCount',
            'seekCount',
            'recommendationCount',
            'saves',
        ];
        const allowedBooleanKeys = ['didFinish', 'isSponsored', 'completed'];

        for (const key of allowedNumericKeys) {
            if (typeof cleaned.engagementMetrics[key] === 'number' && Number.isFinite(cleaned.engagementMetrics[key])) {
                safeMetrics[key] = cleaned.engagementMetrics[key];
            }
        }

        for (const key of allowedBooleanKeys) {
            if (typeof cleaned.engagementMetrics[key] === 'boolean') {
                safeMetrics[key] = cleaned.engagementMetrics[key];
            }
        }

        const analytics = cleaned.engagementMetrics.analytics;
        if (analytics && typeof analytics === 'object' && !Array.isArray(analytics)) {
            const analyticsRecord = analytics as Record<string, unknown>;
            safeMetrics.analytics = {
                duration: typeof analyticsRecord.duration === 'number' ? analyticsRecord.duration : 0,
                watchedSeconds: typeof analyticsRecord.watchedSeconds === 'number' ? analyticsRecord.watchedSeconds : 0,
                loops: typeof analyticsRecord.loops === 'number' ? analyticsRecord.loops : 0,
                seekCount: typeof analyticsRecord.seekCount === 'number' ? analyticsRecord.seekCount : 0,
                didFinish: Boolean(analyticsRecord.didFinish),
                exitReason: sanitizeString(analyticsRecord.exitReason) ?? 'unknown',
                interaction: analyticsRecord.interaction && typeof analyticsRecord.interaction === 'object'
                    ? {
                        liked: Boolean((analyticsRecord.interaction as Record<string, unknown>).liked),
                        commented: Boolean((analyticsRecord.interaction as Record<string, unknown>).commented),
                        shared: Boolean((analyticsRecord.interaction as Record<string, unknown>).shared),
                        clickedProfile: Boolean((analyticsRecord.interaction as Record<string, unknown>).clickedProfile),
                        clickedExternalLink: Boolean((analyticsRecord.interaction as Record<string, unknown>).clickedExternalLink),
                        clickedShop: Boolean((analyticsRecord.interaction as Record<string, unknown>).clickedShop),
                    }
                    : undefined,
            };
        }

        const recommendations = sanitizeRecommendationRows(cleaned.engagementMetrics.recommendations);
        if (recommendations.length > 0) {
            safeMetrics.recommendations = recommendations;
            safeMetrics.recommendationCount = recommendations.length;
        }

        cleaned.engagementMetrics = safeMetrics as Record<string, any>;
    }

    // Clean content tags - only allow safe characters
    if (cleaned.contentTags) {
        cleaned.contentTags = cleaned.contentTags
            .map((tag: string) => tag.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())
            .filter((tag: string) => tag.length > 0 && tag.length < 50)
            .slice(0, 20);
    }

    if (cleaned.contentCategories) {
        cleaned.contentCategories = cleaned.contentCategories
            .map((category: string) => category.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase())
            .filter((category: string) => category.length > 0 && category.length < 50)
            .slice(0, 20);
    }

    return cleaned;
}
