import { coercePlatformFeedPayload, CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS, type PlatformFeedPayload } from '@resma/shared';

interface TwitterSnapshotMessage {
    data?: unknown;
    sessionMetadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

export function createTwitterUploadPayload(message: TwitterSnapshotMessage): PlatformFeedPayload | null {
    const feed = Array.isArray(message.data) ? message.data : [];
    if (feed.length === 0) {
        return null;
    }

    return coercePlatformFeedPayload({
        platform: 'twitter',
        feed,
        sessionMetadata: {
            ...asRecord(message.sessionMetadata),
            observerVersion: CURRENT_OBSERVER_VERSIONS.twitter,
            ingestVersion: CURRENT_INGEST_VERSION,
            uploadEvent: 'TWITTER_FEED_SNAPSHOT',
            capturedAt: new Date().toISOString(),
        },
    }, {
        expectedPlatform: 'twitter',
    });
}
