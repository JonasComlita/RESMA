/**
 * RESMA - Background Service Worker
 * Consolidated authenticated upload pipeline for YouTube, Instagram, and TikTok.
 */

import { packData, getCompressionStats } from '../utils/serialization.js';

type SupportedPlatform = 'youtube' | 'instagram' | 'tiktok';

interface StorageData {
    token?: string;
    apiUrl?: string;
}

interface RecommendationRow {
    videoId: string;
    position?: number;
    title?: string | null;
    channel?: string | null;
    surface?: string | null;
    surfaces?: string[];
}

interface CapturedFeedItem {
    videoId: string;
    creatorHandle?: string | null;
    creatorId?: string | null;
    caption?: string | null;
    positionInFeed?: number;
    position?: number;
    musicTitle?: string | null;
    watchDuration?: number;
    contentTags?: string[];
    contentCategories?: string[];
    interacted?: boolean;
    interactionType?: string | null;
    engagementMetrics?: Record<string, unknown>;
    recommendations?: RecommendationRow[];
}

interface CaptureSessionMetadata {
    type?: string;
    captureSurface?: string;
    clientSessionId?: string;
    observerVersion?: string;
    ingestVersion?: string;
    capturedAt?: string;
    uploadEvent?: string;
    [key: string]: unknown;
}

interface PlatformFeedPayload {
    platform: SupportedPlatform;
    feed: CapturedFeedItem[];
    sessionMetadata: CaptureSessionMetadata;
}

interface LegacySessionData {
    videos?: any[];
    startTime?: number;
    scrollEvents?: number;
}

const DEFAULT_API_URL = 'http://localhost:3001';

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizePlatform(value: unknown): SupportedPlatform | null {
    const normalized = sanitizeString(value)?.toLowerCase();
    if (normalized === 'youtube' || normalized === 'instagram' || normalized === 'tiktok') {
        return normalized;
    }
    return null;
}

function normalizeRecommendationRows(recommendations: unknown): RecommendationRow[] {
    if (!Array.isArray(recommendations)) {
        return [];
    }

    const rows: RecommendationRow[] = [];
    for (let index = 0; index < recommendations.length; index += 1) {
        const row = recommendations[index];
        if (!row || typeof row !== 'object') {
            continue;
        }

        const record = row as Record<string, unknown>;
        const videoId = sanitizeString(record.videoId ?? record.id);
        if (!videoId) continue;

        const positionRaw = typeof record.position === 'number'
            ? record.position
            : Number.parseInt(String(record.position ?? index + 1), 10);
        const position = Number.isFinite(positionRaw) ? Math.max(1, Math.round(positionRaw)) : (index + 1);

        rows.push({
            videoId,
            position,
            title: sanitizeString(record.title),
            channel: sanitizeString(record.channel ?? record.author ?? record.username),
            surface: sanitizeString(record.surface ?? record.source ?? record.placement),
            surfaces: Array.isArray(record.surfaces)
                ? record.surfaces
                    .map((surface) => sanitizeString(surface))
                    .filter((surface): surface is string => Boolean(surface))
                    .slice(0, 6)
                : undefined,
        });
    }

    return rows.slice(0, 40);
}

function normalizeFeedItem(rawItem: unknown, index: number): CapturedFeedItem | null {
    if (!rawItem || typeof rawItem !== 'object') {
        return null;
    }

    const item = rawItem as Record<string, unknown>;
    const videoId = sanitizeString(item.videoId ?? item.id ?? item.postId ?? item.mediaId);
    if (!videoId) {
        return null;
    }

    const positionRaw = typeof item.positionInFeed === 'number'
        ? item.positionInFeed
        : typeof item.position === 'number'
            ? item.position
            : index;
    const positionInFeed = Number.isFinite(positionRaw) ? Math.max(0, Math.round(positionRaw)) : index;

    const recommendations = normalizeRecommendationRows(item.recommendations);
    const baseMetrics = item.engagementMetrics && typeof item.engagementMetrics === 'object'
        ? (item.engagementMetrics as Record<string, unknown>)
        : {};

    const engagementMetrics: Record<string, unknown> = {
        ...baseMetrics,
    };
    if (recommendations.length > 0) {
        engagementMetrics.recommendations = recommendations;
        engagementMetrics.recommendationCount = recommendations.length;
    }

    return {
        videoId,
        creatorHandle: sanitizeString(item.creatorHandle ?? item.author ?? item.channel ?? item.username),
        creatorId: sanitizeString(item.creatorId ?? item.author ?? item.channelName),
        caption: sanitizeString(item.caption ?? item.title),
        positionInFeed,
        position: positionInFeed,
        musicTitle: sanitizeString(item.musicTitle),
        watchDuration: typeof item.watchDuration === 'number'
            ? item.watchDuration
            : typeof item.watchTime === 'number'
                ? item.watchTime
                : undefined,
        contentTags: Array.isArray(item.contentTags)
            ? item.contentTags
                .map((tag) => sanitizeString(tag))
                .filter((tag): tag is string => Boolean(tag))
                .slice(0, 20)
            : [],
        contentCategories: Array.isArray(item.contentCategories)
            ? item.contentCategories
                .map((category) => sanitizeString(category))
                .filter((category): category is string => Boolean(category))
                .slice(0, 20)
            : [],
        interacted: Boolean(item.interacted ?? item.hasInteracted),
        interactionType: sanitizeString(item.interactionType),
        engagementMetrics,
        recommendations,
    };
}

function normalizeSessionMetadata(input: unknown): CaptureSessionMetadata {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return {};
    }

    return { ...(input as Record<string, unknown>) };
}

function normalizePlatformPayload(rawPayload: unknown): PlatformFeedPayload | null {
    if (!rawPayload || typeof rawPayload !== 'object') {
        return null;
    }

    const payload = rawPayload as Record<string, unknown>;
    const platform = normalizePlatform(payload.platform);
    if (!platform) return null;

    const rawFeed = Array.isArray(payload.feed) ? payload.feed : null;
    if (!rawFeed || rawFeed.length === 0) return null;

    const feed = rawFeed
        .map((item, index) => normalizeFeedItem(item, index))
        .filter((item): item is CapturedFeedItem => Boolean(item));
    if (feed.length === 0) return null;

    return {
        platform,
        feed,
        sessionMetadata: normalizeSessionMetadata(payload.sessionMetadata),
    };
}

function convertLegacySessionToPayload(rawSession: LegacySessionData): PlatformFeedPayload | null {
    const videos = Array.isArray(rawSession.videos) ? rawSession.videos : [];
    if (videos.length === 0) return null;

    const feed: CapturedFeedItem[] = videos
        .map((video, index) => {
            const recommendations = normalizeRecommendationRows(video.recommendations ?? video.analytics?.recommendations);
            const item = normalizeFeedItem({
                videoId: video.videoId,
                creatorHandle: video.creatorHandle,
                creatorId: video.creatorId,
                caption: video.caption,
                musicTitle: video.musicTitle,
                positionInFeed: index,
                watchDuration: video.analytics?.watchedSeconds ?? video.watchDuration,
                engagementMetrics: {
                    ...video.engagement,
                    analytics: video.analytics,
                    isSponsored: Boolean(video.isSponsored),
                    recommendations,
                },
                recommendations,
                contentTags: video.isSponsored ? ['sponsored'] : [],
                contentCategories: ['for-you'],
            }, index);
            return item;
        })
        .filter((item): item is CapturedFeedItem => Boolean(item));

    if (feed.length === 0) return null;

    return {
        platform: 'tiktok',
        feed,
        sessionMetadata: {
            type: 'MANUAL_CAPTURE_SESSION',
            captureSurface: 'for-you-feed',
            clientSessionId: sanitizeString((rawSession as any).sessionId),
            observerVersion: 'tiktok-observer-v2',
            ingestVersion: 'cross-platform-v1',
            duration: typeof rawSession.startTime === 'number' ? Date.now() - rawSession.startTime : undefined,
            scrollEvents: typeof rawSession.scrollEvents === 'number' ? rawSession.scrollEvents : 0,
            capturedAt: new Date().toISOString(),
        },
    };
}

function uploadEndpointForPlatform(platform: SupportedPlatform): string {
    if (platform === 'youtube') return `${DEFAULT_API_URL}/youtube/feed`;
    if (platform === 'instagram') return `${DEFAULT_API_URL}/instagram/feed`;
    return `${DEFAULT_API_URL}/feeds`;
}

function payloadForPlatformUpload(payload: PlatformFeedPayload): Record<string, unknown> {
    if (payload.platform === 'tiktok') {
        return {
            platform: payload.platform,
            feed: payload.feed,
            sessionMetadata: payload.sessionMetadata,
        };
    }

    return {
        feed: payload.feed,
        sessionMetadata: payload.sessionMetadata,
    };
}

async function getAuthStatus(): Promise<{ isAuthenticated: boolean; user?: any }> {
    const data = await chrome.storage.local.get('token') as StorageData;
    if (!data.token) {
        return { isAuthenticated: false };
    }

    try {
        const response = await fetch(`${DEFAULT_API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${data.token}` },
        });

        if (!response.ok) {
            return { isAuthenticated: false };
        }

        const result = await response.json();
        return { isAuthenticated: true, user: result.data.user };
    } catch (error) {
        console.error('[RESMA] Auth check failed:', error);
        return { isAuthenticated: false };
    }
}

async function getAuthToken(): Promise<string | null> {
    const data = await chrome.storage.local.get('token') as StorageData;
    return data.token ?? null;
}

async function uploadPayload(endpoint: string, payload: Record<string, unknown>, token: string): Promise<boolean> {
    try {
        const packedBody = packData(payload);
        const stats = getCompressionStats(JSON.stringify(payload), packedBody);
        console.log(
            `[RESMA] ${endpoint} compression: ${stats.jsonBytes}B -> ${stats.packedBytes}B (${stats.savingsPercent.toFixed(1)}% savings)`
        );

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-msgpack',
                Authorization: `Bearer ${token}`,
            },
            body: packedBody.buffer.slice(
                packedBody.byteOffset,
                packedBody.byteOffset + packedBody.byteLength
            ) as ArrayBuffer,
        });

        if (response.ok) {
            return true;
        }

        console.warn(`[RESMA] Binary upload failed (${response.status}), falling back to JSON`);
    } catch (error) {
        console.warn('[RESMA] Binary upload error, falling back to JSON:', error);
    }

    try {
        const fallbackResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });
        return fallbackResponse.ok;
    } catch (error) {
        console.error('[RESMA] JSON fallback failed:', error);
        return false;
    }
}

async function handlePlatformUpload(rawPayload: unknown) {
    const payload = normalizePlatformPayload(rawPayload);
    if (!payload) {
        console.warn('[RESMA] Skipping upload: invalid platform payload');
        return;
    }

    const token = await getAuthToken();
    if (!token) {
        console.error(`[RESMA] Not authenticated for ${payload.platform} upload`);
        return;
    }

    const endpoint = uploadEndpointForPlatform(payload.platform);
    const requestPayload = payloadForPlatformUpload(payload);
    const success = await uploadPayload(endpoint, requestPayload, token);

    if (!success) {
        console.error(`[RESMA] Upload failed for ${payload.platform}`);
    }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
        case 'NEW_VIDEO_CAPTURED':
            console.log('[RESMA] Video captured:', message.data?.videoId);
            break;

        case 'UPLOAD_PLATFORM_FEED':
            handlePlatformUpload(message.payload);
            break;

        case 'UPLOAD_SESSION': {
            const payload = convertLegacySessionToPayload((message.data ?? {}) as LegacySessionData);
            if (payload) {
                handlePlatformUpload(payload);
            }
            break;
        }

        case 'YOUTUBE_VIDEO_COMPLETE':
            handlePlatformUpload({
                platform: 'youtube',
                feed: [message.data],
                sessionMetadata: {
                    ...(message.sessionMetadata && typeof message.sessionMetadata === 'object' ? message.sessionMetadata : {}),
                    uploadEvent: 'YOUTUBE_VIDEO_COMPLETE',
                },
            });
            break;

        case 'YOUTUBE_HOMEPAGE_SNAPSHOT':
            handlePlatformUpload({
                platform: 'youtube',
                feed: Array.isArray(message.data) ? message.data : [],
                sessionMetadata: {
                    ...(message.sessionMetadata && typeof message.sessionMetadata === 'object' ? message.sessionMetadata : {}),
                    uploadEvent: 'YOUTUBE_HOMEPAGE_SNAPSHOT',
                },
            });
            break;

        case 'INSTAGRAM_FEED_SNAPSHOT':
            handlePlatformUpload({
                platform: 'instagram',
                feed: Array.isArray(message.data) ? message.data : (Array.isArray(message.feed) ? message.feed : []),
                sessionMetadata: {
                    ...(message.sessionMetadata && typeof message.sessionMetadata === 'object' ? message.sessionMetadata : {}),
                    uploadEvent: 'INSTAGRAM_FEED_SNAPSHOT',
                },
            });
            break;

        case 'INSTAGRAM_REEL_COMPLETE':
            handlePlatformUpload({
                platform: 'instagram',
                feed: [message.data],
                sessionMetadata: {
                    ...(message.sessionMetadata && typeof message.sessionMetadata === 'object' ? message.sessionMetadata : {}),
                    uploadEvent: 'INSTAGRAM_REEL_COMPLETE',
                },
            });
            break;

        case 'GET_AUTH_STATUS':
            getAuthStatus().then(sendResponse);
            return true;

        case 'SET_TOKEN':
            chrome.storage.local.set({ token: message.token });
            sendResponse({ success: true });
            break;

        case 'LOGOUT':
            chrome.storage.local.remove('token');
            sendResponse({ success: true });
            break;

        default:
            break;
    }

    return false;
});

console.log('[RESMA] Service worker initialized');
