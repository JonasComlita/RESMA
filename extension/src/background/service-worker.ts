/**
 * RESMA - Background Service Worker
 * Consolidated authenticated upload pipeline for YouTube, Instagram, and TikTok.
 */

import { packData, getCompressionStats } from '../utils/serialization.js';
import { coercePlatformFeedPayload, CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';
import { createTwitterUploadPayload } from './twitter-service.js';
import { getJwtExpiryTime, isJwtExpired } from './authSession.js';

type SupportedPlatform = 'youtube' | 'instagram' | 'tiktok' | 'twitter' | 'reddit';

interface StorageData {
    token?: string;
    apiUrl?: string;
    installId?: string;
    authMessage?: string | null;
    tokenExpiresAt?: number | null;
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
    clientSessionId?: string | null;
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
const VALID_HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeApiUrl(rawUrl: unknown): string | null {
    if (typeof rawUrl !== 'string') {
        return null;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);
        if (!VALID_HTTP_PROTOCOLS.has(parsed.protocol)) {
            return null;
        }
        parsed.hash = '';
        parsed.pathname = '';
        parsed.search = '';
        return parsed.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

const ENV_API_URL = normalizeApiUrl(import.meta.env?.VITE_API_URL);
const FALLBACK_API_URL = ENV_API_URL ?? DEFAULT_API_URL;

async function getApiBaseUrl(): Promise<string> {
    const data = await chrome.storage.local.get('apiUrl') as StorageData;
    const storageApiUrl = normalizeApiUrl(data.apiUrl);
    if (data.apiUrl && !storageApiUrl) {
        console.warn('[RESMA] Ignoring invalid apiUrl in storage; using fallback API URL');
    }
    return storageApiUrl ?? FALLBACK_API_URL;
}

async function getInstallId(): Promise<string> {
    const data = await chrome.storage.local.get('installId') as StorageData;
    const existingInstallId = sanitizeString(data.installId);
    if (existingInstallId) {
        return existingInstallId;
    }

    const createdInstallId = `inst-${createUploadId()}`;
    await chrome.storage.local.set({ installId: createdInstallId });
    return createdInstallId;
}

function createUploadId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `upl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function shouldAttemptJsonFallback(statusCode: number): boolean {
    if (statusCode === 401 || statusCode === 403) {
        return false;
    }
    return true;
}

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

async function setAuthMessage(message: string | null) {
    await chrome.storage.local.set({ authMessage: message });
}

async function clearStoredToken(message: string | null) {
    await chrome.storage.local.remove('token');
    await chrome.storage.local.set({
        authMessage: message,
        tokenExpiresAt: null,
    });
}

function sessionExpiredMessage() {
    return 'Your RESMA session expired. Sign in again in the dashboard.';
}

function unauthorizedMessage() {
    return 'Your RESMA session is no longer valid. Sign in again in the dashboard.';
}

async function getAuthStatus(): Promise<{ isAuthenticated: boolean; user?: any; message?: string }> {
    const data = await chrome.storage.local.get(['token', 'authMessage', 'tokenExpiresAt']) as StorageData;
    const token = sanitizeString(data.token);
    if (!token) {
        return {
            isAuthenticated: false,
            ...(data.authMessage ? { message: data.authMessage } : {}),
        };
    }

    const expiresAt = typeof data.tokenExpiresAt === 'number' ? data.tokenExpiresAt : getJwtExpiryTime(token);
    if (isJwtExpired(token)) {
        await clearStoredToken(sessionExpiredMessage());
        return {
            isAuthenticated: false,
            message: sessionExpiredMessage(),
        };
    }

    try {
        const apiBaseUrl = await getApiBaseUrl();
        const response = await fetch(`${apiBaseUrl}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (response.status === 401 || response.status === 403) {
            await clearStoredToken(unauthorizedMessage());
            return {
                isAuthenticated: false,
                message: unauthorizedMessage(),
            };
        }

        if (!response.ok) {
            return {
                isAuthenticated: false,
                message: 'Unable to verify your RESMA session right now.',
            };
        }

        const result = await response.json();
        await setAuthMessage(null);
        if (typeof expiresAt === 'number') {
            await chrome.storage.local.set({ tokenExpiresAt: expiresAt });
        }
        return { isAuthenticated: true, user: result.data.user };
    } catch (error) {
        console.error('[RESMA] Auth check failed:', error);
        return {
            isAuthenticated: false,
            message: 'Unable to reach the RESMA API to verify your session.',
        };
    }
}

async function getAuthToken(): Promise<string | null> {
    const data = await chrome.storage.local.get(['token', 'tokenExpiresAt']) as StorageData;
    const normalizedToken = sanitizeString(data.token);
    if (!normalizedToken) {
        return null;
    }

    if (isJwtExpired(normalizedToken)) {
        await clearStoredToken(sessionExpiredMessage());
        return null;
    }

    if (typeof data.tokenExpiresAt !== 'number') {
        await chrome.storage.local.set({ tokenExpiresAt: getJwtExpiryTime(normalizedToken) });
    }

    return normalizedToken;
}

function uploadEndpointForPlatform(platform: SupportedPlatform, apiBaseUrl: string): string {
    if (platform === 'youtube') return `${apiBaseUrl}/youtube/feed`;
    if (platform === 'instagram') return `${apiBaseUrl}/instagram/feed`;
    if (platform === 'twitter') return `${apiBaseUrl}/twitter/feed`;
    if (platform === 'reddit') return `${apiBaseUrl}/reddit/feed`;
    return `${apiBaseUrl}/feeds`;
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

async function uploadPayload(
    endpoint: string,
    payload: Record<string, unknown>,
    token: string,
    uploadId: string,
    platform: SupportedPlatform
): Promise<boolean> {
    try {
        const packedBody = packData(payload);
        const stats = getCompressionStats(JSON.stringify(payload), packedBody);
        console.log(
            `[RESMA] [${platform}] [${uploadId}] ${endpoint} compression: ${stats.jsonBytes}B -> ${stats.packedBytes}B (${stats.savingsPercent.toFixed(1)}% savings)`
        );

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-msgpack',
                Authorization: `Bearer ${token}`,
                'X-Resma-Upload-Id': uploadId,
                'X-Resma-Upload-Format': 'msgpack',
            },
            body: packedBody.buffer.slice(
                packedBody.byteOffset,
                packedBody.byteOffset + packedBody.byteLength
            ) as ArrayBuffer,
        });

        if (response.ok) {
            await setAuthMessage(null);
            console.log(`[RESMA] [${platform}] [${uploadId}] MessagePack upload succeeded (${response.status})`);
            return true;
        }

        if (!shouldAttemptJsonFallback(response.status)) {
            if (response.status === 401 || response.status === 403) {
                await clearStoredToken(unauthorizedMessage());
            }
            console.error(`[RESMA] [${platform}] [${uploadId}] MessagePack upload failed with non-retryable status ${response.status}`);
            return false;
        }

        console.warn(`[RESMA] [${platform}] [${uploadId}] MessagePack upload failed (${response.status}), falling back to JSON`);
    } catch (error) {
        console.warn(`[RESMA] [${platform}] [${uploadId}] MessagePack upload error, falling back to JSON:`, error);
    }

    try {
        const fallbackResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'X-Resma-Upload-Id': uploadId,
                'X-Resma-Upload-Format': 'json-fallback',
            },
            body: JSON.stringify(payload),
        });
        if (!fallbackResponse.ok) {
            if (fallbackResponse.status === 401 || fallbackResponse.status === 403) {
                await clearStoredToken(unauthorizedMessage());
            }
            console.error(`[RESMA] [${platform}] [${uploadId}] JSON fallback failed with status ${fallbackResponse.status}`);
            return false;
        }
        await setAuthMessage(null);
        console.log(`[RESMA] [${platform}] [${uploadId}] JSON fallback upload succeeded (${fallbackResponse.status})`);
        return fallbackResponse.ok;
    } catch (error) {
        console.error(`[RESMA] [${platform}] [${uploadId}] JSON fallback failed:`, error);
        return false;
    }
}

async function handlePlatformUpload(rawPayload: unknown): Promise<boolean> {
    const payload = coercePlatformFeedPayload(rawPayload) as PlatformFeedPayload | null;
    if (!payload) {
        console.warn('[RESMA] Skipping upload: payload failed shared contract coercion');
        return false;
    }

    const token = await getAuthToken();
    if (!token) {
        console.error(`[RESMA] Not authenticated for ${payload.platform} upload`);
        return false;
    }

    const apiBaseUrl = await getApiBaseUrl();
    const endpoint = uploadEndpointForPlatform(payload.platform, apiBaseUrl);
    const requestPayload = payloadForPlatformUpload({
        ...payload,
        sessionMetadata: {
            ...payload.sessionMetadata,
            clientInstallId: await getInstallId(),
        },
    });
    const uploadId = createUploadId();
    const success = await uploadPayload(endpoint, requestPayload, token, uploadId, payload.platform);

    if (!success) {
        console.error(`[RESMA] [${payload.platform}] [${uploadId}] Upload failed`);
    }

    return success;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
        case 'NEW_VIDEO_CAPTURED':
            console.log('[RESMA] Video captured:', message.data?.videoId);
            break;

        case 'UPLOAD_PLATFORM_FEED':
            handlePlatformUpload(message.payload)
                .then((success) => sendResponse({ success }))
                .catch((error) => {
                    console.error('[RESMA] Unhandled upload pipeline error:', error);
                    sendResponse({ success: false, error: 'Unhandled upload pipeline error' });
                });
            return true;

        case 'TWITTER_FEED_SNAPSHOT': {
            const payload = createTwitterUploadPayload(message);
            if (!payload) {
                sendResponse({ success: false, error: 'Invalid Twitter snapshot payload' });
                break;
            }

            handlePlatformUpload(payload)
                .then((success) => sendResponse({ success }))
                .catch((error) => {
                    console.error('[RESMA] Unhandled Twitter upload pipeline error:', error);
                    sendResponse({ success: false, error: 'Unhandled Twitter upload pipeline error' });
                });
            return true;
        }

        case 'UPLOAD_SESSION':
            sendResponse({ success: false, error: 'Legacy session upload is not supported in this worker build' });
            return false;

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

        case 'SET_TOKEN': {
            const token = sanitizeString(message.token);
            if (!token) {
                sendResponse({ success: false, error: 'Invalid token' });
                break;
            }

            if (isJwtExpired(token)) {
                sendResponse({ success: false, error: sessionExpiredMessage() });
                break;
            }

            const updates: StorageData = {
                token,
                authMessage: null,
                tokenExpiresAt: getJwtExpiryTime(token),
            };
            const apiUrl = normalizeApiUrl(message.apiUrl);
            if (apiUrl) {
                updates.apiUrl = apiUrl;
            }

            chrome.storage.local.set(updates);
            sendResponse({ success: true });
            break;
        }

        case 'LOGOUT':
            chrome.storage.local.remove(['token', 'authMessage', 'tokenExpiresAt']);
            sendResponse({ success: true });
            break;

        default:
            break;
    }

    return false;
});

console.log('[RESMA] Service worker initialized');
