import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';

export interface ParsedRecommendation {
    videoId: string;
    title: string | null;
    channel: string | null;
    position: number;
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

function extractFromUrl(value: string): string | null {
    try {
        const parsed = new URL(value);

        const fromQuery = parsed.searchParams.get('v');
        if (fromQuery) return fromQuery;

        const pathname = parsed.pathname;
        const shortsMatch = pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,20})/);
        if (shortsMatch?.[1]) return shortsMatch[1];

        if (parsed.hostname.includes('youtu.be')) {
            const id = pathname.replace(/^\/+/, '').split('/')[0];
            if (id) return id;
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
        candidate = extractFromUrl(candidate) ?? '';
    } else if (candidate.includes('v=')) {
        const fromQuery = candidate.split('v=')[1]?.split('&')[0];
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
        const normalized: ParsedRecommendation = {
            videoId,
            title: sanitizeString(recObj.title),
            channel: sanitizeString(recObj.channel),
            position,
        };

        const existing = deduped.get(videoId);
        if (!existing || position < existing.position) {
            deduped.set(videoId, normalized);
        }
    }

    return Array.from(deduped.values())
        .sort((a, b) => a.position - b.position)
        .slice(0, maxRecommendations);
}
