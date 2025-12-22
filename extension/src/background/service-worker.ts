/**
 * RESMA - Background Service Worker
 * Handles communication between content scripts and popup
 */

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

    try {
        const response = await fetch(`${API_URL}/feeds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${data.token}`,
            },
            body: JSON.stringify({
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
            }),
        });

        if (response.ok) {
            console.log('[RESMA] Session uploaded successfully');
        } else {
            console.error('[RESMA] Upload failed:', response.status);
        }
    } catch (error) {
        console.error('[RESMA] Upload error:', error);
    }
}

import '../background/instagram-service.js';
console.log('[RESMA] Service worker initialized');
