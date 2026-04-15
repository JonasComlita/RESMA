import { describe, expect, it } from 'vitest';
import {
    deriveYouTubeCreatorIdentity,
    hasYouTubeWatchSignals,
    normalizeYouTubeCreatorHandle,
    parseNonNegativeInt,
} from '../src/routes/youtube';

describe('YouTube route helpers', () => {
    it('preserves explicit zero engagement counts', () => {
        expect(parseNonNegativeInt(0)).toBe(0);
        expect(parseNonNegativeInt('0')).toBe(0);
        expect(parseNonNegativeInt(-1)).toBeNull();
    });

    it('normalizes YouTube channel handles to a stable token', () => {
        expect(normalizeYouTubeCreatorHandle('/@CreatorName')).toBe('CreatorName');
        expect(normalizeYouTubeCreatorHandle('https://www.youtube.com/@CreatorName/videos')).toBe('CreatorName');
        expect(normalizeYouTubeCreatorHandle('@CreatorName')).toBe('CreatorName');
    });

    it('prefers normalized handle for creator identity keys', () => {
        expect(
            deriveYouTubeCreatorIdentity({
                channelHandle: '/@CreatorName',
                channelName: 'Creator Name',
            })
        ).toEqual({
            creatorHandle: 'CreatorName',
            creatorId: 'CreatorName',
        });
    });

    it('treats engagement-metric recommendations as watch signals', () => {
        expect(
            hasYouTubeWatchSignals({
                engagementMetrics: {
                    recommendations: [{ videoId: 'next-video' }],
                },
            })
        ).toBe(true);
    });
});
