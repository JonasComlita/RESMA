import { describe, it, expect } from 'vitest';
import { packAndCompress, decompressAndUnpack } from '../src/services/serialization';

describe('Enhanced Analytics Serialization', () => {
    // TikTok Data Structure Verification
    it('should correctly serialize TikTok enhanced analytics', () => {
        const tiktokData = {
            likes: 1200,
            comments: 45,
            shares: 12,
            analytics: {
                duration: 60,
                watchedSeconds: 45,
                loops: 2,
                seekCount: 1,
                exitReason: 'scrolled',
                interaction: {
                    liked: true,
                    clickedProfile: true,
                    clickedShop: false
                }
            },
            isSponsored: false
        };

        const packed = packAndCompress(tiktokData);
        const unpacked = decompressAndUnpack(packed.data);

        expect(unpacked).toMatchObject(tiktokData);
        // @ts-ignore
        expect(unpacked.analytics.duration).toBe(60);
    });

    // YouTube Data Structure Verification
    it('should correctly serialize YouTube enhanced analytics', () => {
        const youtubeData = {
            watchTime: 120.5,
            seekCount: 3,
            completed: true,
            views: '1.2M',
            uploadDate: '2 weeks ago',
            recommendations: [
                { videoId: 'abc', title: 'Rec 1' },
                { videoId: 'def', title: 'Rec 2' }
            ],
            adEvents: [
                { type: 'ad_start', timestamp: 1234567890 },
                { type: 'ad_skip', timestamp: 1234567895 }
            ]
        };

        const packed = packAndCompress(youtubeData);
        const unpacked = decompressAndUnpack(packed.data);

        expect(unpacked).toMatchObject(youtubeData);
        // @ts-ignore
        expect(unpacked.adEvents).toHaveLength(2);
        // @ts-ignore
        expect(unpacked.recommendations[0].title).toBe('Rec 1');
    });
});
