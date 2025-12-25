/**
 * RESMA - Background Service Worker
 * Handles communication between content scripts and popup
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

// Track active sessions per tab
const activeSessions = new Map<number, boolean>();

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    switch (message.type) {
        case 'NEW_VIDEO_CAPTURED':
            console.log('[RESMA] Video captured:', message.data.videoId);
            break;

        case 'UPLOAD_SESSION':
            handleSessionUpload(message.data);
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
    }
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

        if (response.ok) {
            const result = await response.json();
            return { isAuthenticated: true, user: result.data.user };
        }
    } catch (error) {
        console.error('[RESMA] Auth check failed:', error);
    }

    return { isAuthenticated: false };
}

async function handleSessionUpload(session: SessionData) {
    const data = await chrome.storage.local.get('token') as StorageData;

    if (!data.token) {
        console.error('[RESMA] Not authenticated');
        return;
    }

    // Prepare the payload
    const payload = {
        items: session.videos.map((v, i) => ({
            videoId: v.videoId,
            creatorHandle: v.creatorHandle,
            caption: v.caption,
            musicTitle: v.musicTitle,
            positionInFeed: i,
        })),
        sessionMetadata: {
            duration: Date.now() - session.startTime,
            scrollEvents: session.scrollEvents,
        },
    };

    try {
        // Pack with MessagePack for ~80% size reduction
        const packedBody = packData(payload);

        // Log compression stats for debugging
        const jsonString = JSON.stringify(payload);
        const stats = getCompressionStats(jsonString, packedBody);
        console.log(`[RESMA] Compression: ${stats.jsonBytes}B → ${stats.packedBytes}B (${stats.savingsPercent.toFixed(1)}% savings)`);

        const response = await fetch(`${API_URL}/feeds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-msgpack',
                Authorization: `Bearer ${data.token}`,
            },
            body: packedBody.buffer.slice(packedBody.byteOffset, packedBody.byteOffset + packedBody.byteLength) as ArrayBuffer,
        });

        if (response.ok) {
            console.log('[RESMA] Session uploaded successfully');
        } else {
            console.error('[RESMA] Upload failed:', response.status);
            // Fall back to JSON if server doesn't support msgpack yet
            await uploadAsJson(payload, data.token);
        }
    } catch (error) {
        console.error('[RESMA] Upload error:', error);
        // Fall back to JSON on compression error
        try {
            const payload = {
                items: session.videos.map((v, i) => ({
                    videoId: v.videoId,
                    creatorHandle: v.creatorHandle,
                    caption: v.caption,
                    musicTitle: v.musicTitle,
                    positionInFeed: i,
                })),
                sessionMetadata: {
                    duration: Date.now() - session.startTime,
                    scrollEvents: session.scrollEvents,
                },
            };
            await uploadAsJson(payload, data.token);
        } catch (fallbackError) {
            console.error('[RESMA] Fallback upload also failed:', fallbackError);
        }
    }
}

/**
 * Fallback: upload using JSON (for backwards compatibility)
 */
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

    if (response.ok) {
        console.log('[RESMA] JSON fallback upload successful');
    } else {
        console.error('[RESMA] JSON fallback upload failed:', response.status);
    }
}

import '../background/instagram-service.js';
console.log('[RESMA] Service worker initialized');
