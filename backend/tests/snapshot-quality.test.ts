import { describe, expect, it } from 'vitest';
import {
    buildSessionQualityMetadata,
    buildSnapshotFingerprint,
} from '../src/services/snapshotQuality';

describe('Snapshot quality metadata', () => {
    it('builds deterministic fingerprint from feed order', () => {
        const fingerprint = buildSnapshotFingerprint([
            { videoId: 'vidC', positionInFeed: 2 },
            { videoId: 'vidA', positionInFeed: 0 },
            { videoId: 'vidB', positionInFeed: 1 },
        ]);

        expect(fingerprint.orderedVideoIds).toEqual(['vidA', 'vidB', 'vidC']);
        expect(fingerprint.key).toBe('vidA|vidB|vidC');
        expect(fingerprint.hash).toHaveLength(16);
    });

    it('enriches and preserves session metadata with quality fields', () => {
        const enriched = buildSessionQualityMetadata({
            userId: 'user-1',
            platform: 'youtube',
            capturedAt: new Date('2026-04-07T02:30:00.000Z'),
            feedItems: [
                { videoId: 'seedvideo001', positionInFeed: 0 },
                { videoId: 'targetvid001', positionInFeed: 1 },
            ],
            existingMetadata: {
                type: 'VIDEO_WATCH',
                sessionId: 'client-session-123',
            },
        });

        expect(enriched.type).toBe('VIDEO_WATCH');
        expect(typeof enriched.quality).toBe('object');
        const quality = enriched.quality as Record<string, unknown>;

        expect(quality.schemaVersion).toBe(1);
        expect(quality.parserVersion).toBe('strict-v1');
        expect(typeof quality.fingerprintHash).toBe('string');
        expect(typeof quality.stitchedSessionKey).toBe('string');
        expect(quality.fingerprintSize).toBe(2);
    });
});

