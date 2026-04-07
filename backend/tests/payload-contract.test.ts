import { describe, expect, it } from 'vitest';
import {
    coerceFeedSnapshotEnvelope,
    coercePlatformFeedPayload,
    CURRENT_INGEST_VERSION,
    CURRENT_OBSERVER_VERSIONS,
} from '@resma/shared';

describe('Shared payload contract coercion', () => {
    it('coerces legacy YouTube-shaped payloads and applies shared version defaults', () => {
        const payload = coercePlatformFeedPayload(
            {
                platform: 'youtube',
                feed: [
                    {
                        id: 'abc123xyz78',
                        title: 'A test video',
                        channelHandle: '@creator',
                        watchTime: 14.5,
                        recommendations: [{ id: 'def456uvw90' }],
                    },
                ],
                sessionMetadata: {
                    type: 'VIDEO_WATCH',
                    clientSessionId: ' yt-session-1 ',
                },
            },
            { expectedPlatform: 'youtube' }
        );

        expect(payload).not.toBeNull();
        expect(payload?.platform).toBe('youtube');
        expect(payload?.sessionMetadata.ingestVersion).toBe(CURRENT_INGEST_VERSION);
        expect(payload?.sessionMetadata.observerVersion).toBe(CURRENT_OBSERVER_VERSIONS.youtube);
        expect(payload?.feed[0]).toMatchObject({
            videoId: 'abc123xyz78',
            caption: 'A test video',
            creatorHandle: '@creator',
            watchDuration: 14.5,
        });
        expect(payload?.feed[0].engagementMetrics?.watchTime).toBe(14.5);
        expect(payload?.feed[0].recommendations?.map((row) => row.videoId)).toEqual(['def456uvw90']);
    });

    it('supports items[] alias and default platform fallback for TikTok snapshots', () => {
        const payload = coercePlatformFeedPayload(
            {
                items: [
                    {
                        mediaId: '7429012345678901234',
                        creatorHandle: '@tt_creator',
                        caption: 'For you page card',
                        impressionDuration: '7.5',
                        hasInteracted: 'true',
                    },
                ],
                sessionMetadata: {
                    uploadEvent: 'MANUAL_CAPTURE',
                },
            },
            { defaultPlatform: 'tiktok' }
        );

        expect(payload).not.toBeNull();
        expect(payload?.platform).toBe('tiktok');
        expect(payload?.sessionMetadata.ingestVersion).toBe(CURRENT_INGEST_VERSION);
        expect(payload?.sessionMetadata.observerVersion).toBe(CURRENT_OBSERVER_VERSIONS.tiktok);
        expect(payload?.feed[0]).toMatchObject({
            videoId: '7429012345678901234',
            creatorHandle: '@tt_creator',
            caption: 'For you page card',
            watchDuration: 7.5,
            interacted: true,
        });
    });

    it('rejects payloads when no valid feed item can be coerced', () => {
        const payload = coercePlatformFeedPayload(
            {
                platform: 'instagram',
                feed: [{ title: 'missing-id' }, null, {}],
            },
            { expectedPlatform: 'instagram' }
        );

        expect(payload).toBeNull();
    });

    it('can fail closed when requireFullFeedValidity is enabled', () => {
        const payload = coercePlatformFeedPayload(
            {
                platform: 'tiktok',
                feed: [
                    { videoId: '7429012345678901234', caption: 'valid' },
                    { caption: 'missing-id' },
                ],
            },
            {
                expectedPlatform: 'tiktok',
                requireFullFeedValidity: true,
            }
        );

        expect(payload).toBeNull();
    });

    it('coerces snapshot envelopes used by platform-specific routes', () => {
        const envelope = coerceFeedSnapshotEnvelope(
            {
                items: [
                    {
                        id: 'C9xAbCdEf12',
                        username: 'creator_name',
                        caption: 'Example reel',
                        watchTime: 3.2,
                    },
                ],
            },
            {
                defaultObserverVersion: 'legacy-instagram-observer',
            }
        );

        expect(envelope).not.toBeNull();
        expect(envelope?.sessionMetadata.ingestVersion).toBe(CURRENT_INGEST_VERSION);
        expect(envelope?.sessionMetadata.observerVersion).toBe('legacy-instagram-observer');
        expect(envelope?.feed[0]).toMatchObject({
            videoId: 'C9xAbCdEf12',
            creatorHandle: 'creator_name',
            caption: 'Example reel',
            watchDuration: 3.2,
        });
    });

    it('preserves valid session metadata keys even when one key is malformed', () => {
        const payload = coercePlatformFeedPayload(
            {
                platform: 'youtube',
                feed: [{ videoId: 'abc123xyz78' }],
                sessionMetadata: {
                    type: {},
                    captureSurface: 'watch',
                    clientSessionId: 'sess-1',
                    uploadEvent: 'YOUTUBE_VIDEO_COMPLETE',
                },
            },
            { expectedPlatform: 'youtube' }
        );

        expect(payload).not.toBeNull();
        expect(payload?.sessionMetadata.captureSurface).toBe('watch');
        expect(payload?.sessionMetadata.clientSessionId).toBe('sess-1');
        expect(payload?.sessionMetadata.uploadEvent).toBe('YOUTUBE_VIDEO_COMPLETE');
        expect(payload?.sessionMetadata.ingestVersion).toBe(CURRENT_INGEST_VERSION);
    });
});
