import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';

export interface ParsedRecommendation {
    videoId: string;
    title: string | null;
    channel: string | null;
    position: number;
    surface: string | null;
    surfaces: string[];
}

interface ExtractRecommendationOptions {
    platform: string;
    sourceVideoId?: string | null;
    maxRecommendations?: number;
}

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

function normalizeSurface(value: unknown): string | null {
    const sanitized = sanitizeString(value);
    if (!sanitized) return null;

    const normalized = sanitized
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/\s+/g, '-');

    if (!normalized) return null;
    return normalized.slice(0, 48);
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

        if (platform === 'youtube') {
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

        if (platform === 'instagram') {
            const reelMatch = pathname.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,64})/);
            if (reelMatch?.[1]) return reelMatch[1];
            return null;
        }

        if (platform === 'tiktok') {
            const tiktokVideoMatch = pathname.match(/\/video\/([0-9]{5,32})/);
            if (tiktokVideoMatch?.[1]) return tiktokVideoMatch[1];
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

    let candidate = value;

    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        candidate = extractFromUrl(candidate, platform) ?? '';
    } else if (platform === 'youtube' && candidate.includes('v=')) {
        const fromQuery = candidate.split('v=')[1]?.split('&')[0] ?? '';
        candidate = fromQuery || candidate;
    }

    candidate = candidate.trim();
    if (candidate.length < 3 || candidate.length > 128) {
        return null;
    }

    if (platform === 'youtube') {
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(candidate)) {
            return null;
        }
        return candidate;
    }

    if (platform === 'instagram') {
        if (!/^[A-Za-z0-9_-]{3,64}$/.test(candidate)) {
            return null;
        }
        return candidate;
    }

    if (platform === 'tiktok') {
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

export function extractRecommendationsFromMetrics(
    metrics: Buffer | null,
    options: ExtractRecommendationOptions
): ParsedRecommendation[] {
    const decoded = decodeEngagementMetrics(metrics);
    if (!decoded || typeof decoded !== 'object') return [];

    const recommendations = (decoded as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(recommendations)) return [];

    const sourceVideoId = options.sourceVideoId?.trim() || null;
    const maxRecommendations = options.maxRecommendations ?? 25;
    const deduped = new Map<string, ParsedRecommendation>();

    for (let index = 0; index < recommendations.length; index += 1) {
        if (deduped.size >= maxRecommendations) break;

        const recommendation = recommendations[index];
        if (!recommendation || typeof recommendation !== 'object') continue;
        const recObj = recommendation as Record<string, unknown>;

        const videoId = normalizeVideoId(recObj.videoId, options.platform);
        if (!videoId) continue;
        if (sourceVideoId && videoId === sourceVideoId) continue;

        const position = parsePositiveInt(recObj.position) ?? index + 1;
        const surface = normalizeSurface(recObj.surface ?? recObj.source ?? recObj.placement);
        const surfaces = new Set<string>();
        if (surface) {
            surfaces.add(surface);
        }
        if (Array.isArray(recObj.surfaces)) {
            for (const candidate of recObj.surfaces) {
                const normalized = normalizeSurface(candidate);
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
            } else {
                deduped.set(videoId, normalized);
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

    return Array.from(deduped.values())
        .sort((a, b) => a.position - b.position)
        .slice(0, maxRecommendations);
}
