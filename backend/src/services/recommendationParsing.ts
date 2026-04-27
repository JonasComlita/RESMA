import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';
import { sanitizeString } from '../lib/ingestUtils.js';

export interface ParsedRecommendation {
    videoId: string;
    title: string | null;
    channel: string | null;
    position: number;
    surface: string | null;
    surfaces: string[];
}

export interface RecommendationDropReasons {
    malformedRow: number;
    missingVideoId: number;
    invalidVideoId: number;
    selfReference: number;
    duplicateVideoId: number;
    overRecommendationCap: number;
}

export interface RecommendationParseDiagnostics {
    hasRecommendationArray: boolean;
    rawRecommendationRows: number;
    strictRecommendationRows: number;
    duplicateRecommendationRows: number;
    parserDropRate: number;
    dedupeImpactRate: number;
    droppedRows: number;
    dropReasons: RecommendationDropReasons;
}

export interface RecommendationParseResult {
    recommendations: ParsedRecommendation[];
    diagnostics: RecommendationParseDiagnostics;
}

interface ExtractRecommendationOptions {
    platform: string;
    sourceVideoId?: string | null;
    maxRecommendations?: number;
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

function normalizePlatform(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().toLowerCase()
        : '';
}

const SURFACE_ALIASES: Record<string, Record<string, string>> = {
    youtube: {
        watchnext: 'watch-next-sidebar',
        'watch-next': 'watch-next-sidebar',
        watchnextsidebar: 'watch-next-sidebar',
        upnext: 'watch-next-sidebar',
        endscreen: 'end-screen-overlay',
        'end-screen': 'end-screen-overlay',
        shorts: 'shorts-overlay',
        shortsfeed: 'shorts-overlay',
    },
    instagram: {
        reelsupnext: 'reels-up-next',
        reelupnext: 'reels-up-next',
        reelsrail: 'reels-rail',
        reelssuggestions: 'reels-up-next',
        relatedposts: 'related-posts',
        suggestedposts: 'related-posts',
        exploregrid: 'explore-grid',
    },
    tiktok: {
        foryou: 'for-you-next',
        fyp: 'for-you-next',
        fypnext: 'for-you-next',
        upnext: 'for-you-next',
        related: 'related-link',
    },
};

function normalizeSurface(value: unknown, platform: string): string | null {
    const sanitized = sanitizeString(value);
    if (!sanitized) return null;

    const normalizedBase = sanitized
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    if (!normalizedBase) return null;

    const aliasKey = normalizedBase.replace(/[-_]/g, '');
    const normalizedPlatformName = normalizePlatform(platform);
    const aliased = SURFACE_ALIASES[normalizedPlatformName]?.[aliasKey] ?? normalizedBase;
    return aliased.slice(0, 48);
}

function decodeEngagementMetrics(metrics: Buffer | null): unknown {
    if (!metrics) return null;

    try {
        if (isCompressedMsgpack(metrics)) {
            return decompressAndUnpack<unknown>(metrics);
        }
        return JSON.parse(metrics.toString('utf-8'));
    } catch {
        return null;
    }
}

function extractFromUrl(value: string, platform: string): string | null {
    try {
        const parsed = new URL(value);
        const pathname = parsed.pathname;
        const normalizedPlatformName = normalizePlatform(platform);

        if (normalizedPlatformName === 'youtube') {
            const fromQuery = parsed.searchParams.get('v');
            if (fromQuery) return fromQuery;

            const shortsMatch = pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,20})/);
            if (shortsMatch?.[1]) return shortsMatch[1];

            if (parsed.hostname.includes('youtu.be')) {
                const id = pathname.replace(/^\/+/, '').split('/')[0];
                if (id) return id;
            }
            return null;
        }

        if (normalizedPlatformName === 'instagram') {
            const reelMatch = pathname.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,64})/);
            if (reelMatch?.[1]) return reelMatch[1];
            const shortcodeMatch = parsed.searchParams.get('shortcode');
            if (shortcodeMatch) return shortcodeMatch;
            return null;
        }

        if (normalizedPlatformName === 'tiktok') {
            const tiktokVideoMatch = pathname.match(/\/video\/([0-9]{5,32})/);
            if (tiktokVideoMatch?.[1]) return tiktokVideoMatch[1];
            const queryId = parsed.searchParams.get('item_id')
                ?? parsed.searchParams.get('share_item_id')
                ?? parsed.searchParams.get('aweme_id');
            if (queryId) return queryId;
            return null;
        }
    } catch {
        return null;
    }

    return null;
}

function normalizeVideoId(raw: unknown, platform: string): string | null {
    const value = sanitizeString(raw);
    if (!value) return null;

    const normalizedPlatformName = normalizePlatform(platform);
    let candidate = value;

    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        candidate = extractFromUrl(candidate, normalizedPlatformName) ?? '';
    } else if (normalizedPlatformName === 'youtube' && candidate.includes('v=')) {
        const fromQuery = candidate.split('v=')[1]?.split('&')[0] ?? '';
        candidate = fromQuery || candidate;
    }

    candidate = candidate.trim();
    if (candidate.length < 3 || candidate.length > 128) {
        return null;
    }

    if (normalizedPlatformName === 'youtube') {
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(candidate)) {
            return null;
        }
        return candidate;
    }

    if (normalizedPlatformName === 'instagram') {
        if (!/^[A-Za-z0-9_-]{3,64}$/.test(candidate)) {
            return null;
        }
        return candidate;
    }

    if (normalizedPlatformName === 'tiktok') {
        if (!/^[0-9]{5,32}$/.test(candidate)) {
            return null;
        }
        return candidate;
    }

    if (!/^[A-Za-z0-9:_-]{3,128}$/.test(candidate)) {
        return null;
    }

    return candidate;
}

export function normalizeRecommendationVideoId(raw: unknown, platform: string): string | null {
    return normalizeVideoId(raw, platform);
}

export function normalizeRecommendationSurface(value: unknown, platform: string): string | null {
    return normalizeSurface(value, platform);
}

function createDiagnostics(rawRecommendationRows = 0): RecommendationParseDiagnostics {
    return {
        hasRecommendationArray: rawRecommendationRows > 0,
        rawRecommendationRows,
        strictRecommendationRows: 0,
        duplicateRecommendationRows: 0,
        parserDropRate: 0,
        dedupeImpactRate: 0,
        droppedRows: 0,
        dropReasons: {
            malformedRow: 0,
            missingVideoId: 0,
            invalidVideoId: 0,
            selfReference: 0,
            duplicateVideoId: 0,
            overRecommendationCap: 0,
        },
    };
}

function recommendationIdCandidates(
    recommendation: Record<string, unknown>,
    platform: string
): unknown[] {
    const normalizedPlatformName = normalizePlatform(platform);
    const prioritized: unknown[] = [recommendation.videoId];
    if (normalizedPlatformName === 'youtube') {
        prioritized.push(
            recommendation.watchUrl,
            recommendation.shortUrl,
            recommendation.shareUrl
        );
    } else if (normalizedPlatformName === 'instagram') {
        prioritized.push(
            recommendation.postId,
            recommendation.mediaId,
            recommendation.shortcode,
            recommendation.shortCode,
            recommendation.reelId,
            recommendation.mediaPk
        );
    } else if (normalizedPlatformName === 'tiktok') {
        prioritized.push(
            recommendation.itemId,
            recommendation.item_id,
            recommendation.awemeId,
            recommendation.aweme_id,
            recommendation.video_id
        );
    }

    return [
        ...prioritized,
        recommendation.url,
        recommendation.href,
        recommendation.link,
        recommendation.permalink,
        recommendation.id,
    ];
}

function resolveRecommendationVideoId(
    recommendation: Record<string, unknown>,
    platform: string
): { videoId: string | null; hasCandidateValue: boolean } {
    const candidates = recommendationIdCandidates(recommendation, platform);
    let hasCandidateValue = false;

    for (const candidate of candidates) {
        const asString = sanitizeString(candidate);
        if (!asString) continue;
        hasCandidateValue = true;

        const normalized = normalizeVideoId(asString, platform);
        if (normalized) {
            return {
                videoId: normalized,
                hasCandidateValue,
            };
        }
    }

    return {
        videoId: null,
        hasCandidateValue,
    };
}

function finalizeDiagnostics(
    diagnostics: RecommendationParseDiagnostics,
    strictRecommendationRows: number
) {
    diagnostics.strictRecommendationRows = strictRecommendationRows;
    diagnostics.droppedRows = Math.max(0, diagnostics.rawRecommendationRows - strictRecommendationRows);
    diagnostics.parserDropRate = diagnostics.rawRecommendationRows > 0
        ? Math.max(0, Math.min(1, diagnostics.droppedRows / diagnostics.rawRecommendationRows))
        : 0;
    diagnostics.dedupeImpactRate = diagnostics.rawRecommendationRows > 0
        ? Math.max(0, Math.min(1, diagnostics.duplicateRecommendationRows / diagnostics.rawRecommendationRows))
        : 0;
}

export function extractRecommendationsWithDiagnostics(
    metrics: Buffer | null,
    options: ExtractRecommendationOptions
): RecommendationParseResult {
    const decoded = decodeEngagementMetrics(metrics);
    if (!decoded || typeof decoded !== 'object') {
        return {
            recommendations: [],
            diagnostics: createDiagnostics(0),
        };
    }

    const recommendations = (decoded as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(recommendations)) {
        return {
            recommendations: [],
            diagnostics: createDiagnostics(0),
        };
    }

    const sourceVideoIdRaw = options.sourceVideoId?.trim() || null;
    const sourceVideoId = sourceVideoIdRaw
        ? normalizeVideoId(sourceVideoIdRaw, options.platform) ?? sourceVideoIdRaw
        : null;
    const maxRecommendations = options.maxRecommendations ?? 25;
    const deduped = new Map<string, ParsedRecommendation>();
    const diagnostics = createDiagnostics(recommendations.length);
    diagnostics.hasRecommendationArray = true;

    for (let index = 0; index < recommendations.length; index += 1) {
        const recommendation = recommendations[index];
        if (!recommendation || typeof recommendation !== 'object') {
            diagnostics.dropReasons.malformedRow += 1;
            continue;
        }
        const recObj = recommendation as Record<string, unknown>;

        const resolvedId = resolveRecommendationVideoId(recObj, options.platform);
        if (!resolvedId.videoId) {
            if (resolvedId.hasCandidateValue) {
                diagnostics.dropReasons.invalidVideoId += 1;
            } else {
                diagnostics.dropReasons.missingVideoId += 1;
            }
            continue;
        }

        const videoId = resolvedId.videoId;
        if (sourceVideoId && videoId === sourceVideoId) {
            diagnostics.dropReasons.selfReference += 1;
            continue;
        }

        const position = parsePositiveInt(recObj.position) ?? index + 1;
        const surface = normalizeSurface(
            recObj.surface ?? recObj.source ?? recObj.placement ?? recObj.origin,
            options.platform
        );
        const surfaces = new Set<string>();
        if (surface) {
            surfaces.add(surface);
        }
        if (Array.isArray(recObj.surfaces)) {
            for (const candidate of recObj.surfaces) {
                const normalized = normalizeSurface(candidate, options.platform);
                if (normalized) {
                    surfaces.add(normalized);
                }
            }
        }

        const normalized: ParsedRecommendation = {
            videoId,
            title: sanitizeString(recObj.title),
            channel: sanitizeString(recObj.channel),
            position,
            surface,
            surfaces: Array.from(surfaces),
        };

        const existing = deduped.get(videoId);
        if (existing) {
            diagnostics.duplicateRecommendationRows += 1;
            diagnostics.dropReasons.duplicateVideoId += 1;
        }

        if (!existing || position < existing.position) {
            if (existing) {
                const mergedSurfaces = new Set<string>([...existing.surfaces, ...normalized.surfaces]);
                deduped.set(videoId, {
                    ...normalized,
                    title: normalized.title ?? existing.title,
                    channel: normalized.channel ?? existing.channel,
                    surfaces: Array.from(mergedSurfaces),
                    surface: normalized.surface ?? existing.surface,
                });
            } else if (deduped.size < maxRecommendations) {
                deduped.set(videoId, normalized);
            } else {
                diagnostics.dropReasons.overRecommendationCap += 1;
            }
        } else if (existing) {
            const mergedSurfaces = new Set<string>([...existing.surfaces, ...normalized.surfaces]);
            existing.surfaces = Array.from(mergedSurfaces);
            if (!existing.title && normalized.title) {
                existing.title = normalized.title;
            }
            if (!existing.channel && normalized.channel) {
                existing.channel = normalized.channel;
            }
            if (!existing.surface && normalized.surface) {
                existing.surface = normalized.surface;
            }
        }
    }

    const parsed = Array.from(deduped.values())
        .sort((a, b) => a.position - b.position)
        .slice(0, maxRecommendations);
    finalizeDiagnostics(diagnostics, parsed.length);

    return {
        recommendations: parsed,
        diagnostics,
    };
}

export function extractRecommendationsFromMetrics(
    metrics: Buffer | null,
    options: ExtractRecommendationOptions
): ParsedRecommendation[] {
    return extractRecommendationsWithDiagnostics(metrics, options).recommendations;
}
