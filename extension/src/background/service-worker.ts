/**
 * RESMA - Background Service Worker
 * Handles communication between content scripts and popup.
 */

import { packData, getCompressionStats } from '../utils/serialization.js';

interface SessionData {
    videos: any[];
    startTime: number;
    scrollEvents: number;
}

interface StorageData {
    token?: string;
    apiUrl?: string;
    sessions?: SessionData[];
}

const API_URL = 'http://localhost:3001';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
        case 'NEW_VIDEO_CAPTURED':
            console.log('[RESMA] Video captured:', message.data?.videoId);
            break;

        case 'UPLOAD_SESSION':
            handleSessionUpload(message.data);
            break;

        case 'YOUTUBE_VIDEO_COMPLETE':
            handleYouTubeVideoUpload(message.data, message.sessionMetadata);
            break;

        case 'YOUTUBE_HOMEPAGE_SNAPSHOT':
            handleYouTubeSnapshotUpload(message.data, message.sessionMetadata);
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

async function getAuthStatus(): Promise<{ isAuthenticated: boolean; user?: any }> {
    const data = await chrome.storage.local.get('token') as StorageData;
    if (!data.token) {
        return { isAuthenticated: false };
    }

    try {
        const response = await fetch(`${API_URL}/auth/me`, {
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

async function handleSessionUpload(session: SessionData) {
    const token = await getAuthToken();
    if (!token) {
        console.error('[RESMA] Not authenticated');
        return;
    }

    const payload = {
        items: session.videos.map((video, index) => ({
            videoId: video.videoId,
            creatorHandle: video.creatorHandle,
            caption: video.caption,
            musicTitle: video.musicTitle,
            positionInFeed: index,
            engagementMetrics: {
                ...video.engagement,
                analytics: video.analytics,
                isSponsored: video.isSponsored,
            },
            contentTags: video.isSponsored ? ['sponsored'] : [],
        })),
        sessionMetadata: {
            duration: Date.now() - session.startTime,
            scrollEvents: session.scrollEvents,
        },
    };

    try {
        const packedBody = packData(payload);
        const stats = getCompressionStats(JSON.stringify(payload), packedBody);
        console.log(
            `[RESMA] Compression: ${stats.jsonBytes}B -> ${stats.packedBytes}B (${stats.savingsPercent.toFixed(1)}% savings)`
        );

        const response = await fetch(`${API_URL}/feeds`, {
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

        if (!response.ok) {
            console.error('[RESMA] Upload failed:', response.status);
            await uploadAsJson(payload, token);
            return;
        }

        console.log('[RESMA] Session uploaded successfully');
    } catch (error) {
        console.error('[RESMA] Upload error:', error);
        try {
            await uploadAsJson(payload, token);
        } catch (fallbackError) {
            console.error('[RESMA] Fallback upload also failed:', fallbackError);
        }
    }
}

async function handleYouTubeVideoUpload(videoData: any, sessionMetadata?: Record<string, unknown>) {
    const token = await getAuthToken();
    if (!token) {
        console.error('[RESMA] Not authenticated for YouTube upload');
        return;
    }

    const payload = {
        feed: [videoData],
        sessionMetadata: {
            ...(sessionMetadata && typeof sessionMetadata === 'object' ? sessionMetadata : {}),
            uploadEvent: 'YOUTUBE_VIDEO_COMPLETE',
        },
    };

    await uploadYouTubePayload(payload, token);
}

async function handleYouTubeSnapshotUpload(
    feedData: any[],
    sessionMetadata?: Record<string, unknown>
) {
    const token = await getAuthToken();
    if (!token) {
        console.error('[RESMA] Not authenticated for YouTube snapshot upload');
        return;
    }

    const payload = {
        feed: Array.isArray(feedData) ? feedData : [],
        sessionMetadata: {
            ...(sessionMetadata && typeof sessionMetadata === 'object' ? sessionMetadata : {}),
            uploadEvent: 'YOUTUBE_HOMEPAGE_SNAPSHOT',
        },
    };

    await uploadYouTubePayload(payload, token);
}

async function uploadYouTubePayload(payload: any, token: string) {
    if (!Array.isArray(payload.feed) || payload.feed.length === 0) {
        console.warn('[RESMA] Skipping YouTube upload: empty feed payload');
        return;
    }

    try {
        const packedBody = packData(payload);

        const response = await fetch(`${API_URL}/youtube/feed`, {
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

        if (!response.ok) {
            console.error('[RESMA] YouTube upload failed:', response.status);
            await fetch(`${API_URL}/youtube/feed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
            return;
        }

        console.log('[RESMA] YouTube data uploaded');
    } catch (error) {
        console.error('[RESMA] YouTube upload failed:', error);
        try {
            await fetch(`${API_URL}/youtube/feed`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
        } catch (fallbackError) {
            console.error('[RESMA] YouTube JSON fallback failed:', fallbackError);
        }
    }
}

async function uploadAsJson(payload: any, token: string) {
    console.log('[RESMA] Falling back to JSON upload');

    const response = await fetch(`${API_URL}/feeds`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        console.error('[RESMA] JSON fallback upload failed:', response.status);
        return;
    }

    console.log('[RESMA] JSON fallback upload successful');
}

import '../background/instagram-service.js';
console.log('[RESMA] Service worker initialized');
