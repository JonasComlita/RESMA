import { randomUUID } from 'node:crypto';
import type { PlatformFeedPayload } from '@resma/shared';
import type { UploadResult } from './types.js';

const VALID_HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeApiUrl(rawUrl: string): string {
    const parsed = new URL(rawUrl);
    if (!VALID_HTTP_PROTOCOLS.has(parsed.protocol)) {
        throw new Error(`Unsupported API protocol: ${parsed.protocol}`);
    }
    parsed.hash = '';
    parsed.pathname = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
}

function uploadEndpointForPlatform(platform: PlatformFeedPayload['platform'], apiBaseUrl: string): string {
    if (platform === 'youtube') return `${apiBaseUrl}/youtube/feed`;
    if (platform === 'instagram') return `${apiBaseUrl}/instagram/feed`;
    if (platform === 'twitter') return `${apiBaseUrl}/twitter/feed`;
    return `${apiBaseUrl}/feeds`;
}

function payloadForPlatformUpload(payload: PlatformFeedPayload): Record<string, unknown> {
    return {
        platform: payload.platform,
        feed: payload.feed,
        sessionMetadata: payload.sessionMetadata,
    };
}

export async function uploadCapturePayload(
    payload: PlatformFeedPayload,
    options: {
        apiBaseUrl: string;
        authToken: string;
        uploadId?: string;
    },
): Promise<UploadResult> {
    const apiBaseUrl = normalizeApiUrl(options.apiBaseUrl);
    const endpoint = uploadEndpointForPlatform(payload.platform, apiBaseUrl);
    const uploadId = options.uploadId ?? randomUUID();

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.authToken}`,
            'X-Resma-Upload-Id': uploadId,
            'X-Resma-Upload-Format': 'json-headless',
        },
        body: JSON.stringify(payloadForPlatformUpload(payload)),
    });

    let body: unknown = null;
    try {
        body = await response.json();
    } catch {
        body = await response.text().catch(() => null);
    }

    return {
        endpoint,
        ok: response.ok,
        status: response.status,
        uploadId,
        body,
    };
}
