import { describe, expect, it } from 'vitest';
import {
    extractRecommendationsFromMetrics,
    extractRecommendationsWithDiagnostics,
} from '../src/services/recommendationParsing';

const jsonMetrics = (recommendations: unknown[]) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

describe('Recommendation parsing', () => {
    it('normalizes YouTube IDs, drops invalid rows, filters self refs, and dedupes by best rank', () => {
        const metrics = jsonMetrics([
            {
                videoId: 'https://www.youtube.com/watch?v=abc123XYZ09',
                position: '2',
                title: 'From URL',
                channel: 'chan-a',
                surface: 'watch next sidebar',
            },
            {
                videoId: 'abc123XYZ09',
                position: 1,
                title: 'Direct ID',
                channel: 'chan-b',
                surface: 'end-screen-overlay',
                surfaces: ['watch-next-sidebar', 'end-screen-overlay'],
            },
            {
                videoId: 'https://youtu.be/def456uvw_01?t=42',
                position: 3,
                surface: 'shorts overlay',
            },
            {
                videoId: 'https://www.youtube.com/shorts/ghi789qwe_2',
                position: 4,
            },
            {
                videoId: 'seedvideo001',
                position: 5,
            },
            {
                videoId: '@@@not-a-video-id@@@',
                position: 6,
            },
            {
                videoId: '',
                position: 7,
            },
        ]);

        const recommendations = extractRecommendationsFromMetrics(metrics, {
            platform: 'youtube',
            sourceVideoId: 'seedvideo001',
            maxRecommendations: 10,
        });

        expect(recommendations.map((row) => row.videoId)).toEqual([
            'abc123XYZ09',
            'def456uvw_01',
            'ghi789qwe_2',
        ]);
        expect(recommendations[0]).toMatchObject({
            videoId: 'abc123XYZ09',
            position: 1,
            title: 'Direct ID',
            channel: 'chan-b',
            surface: 'end-screen-overlay',
        });
        expect(recommendations[0].surfaces).toEqual(
            expect.arrayContaining(['watch-next-sidebar', 'end-screen-overlay'])
        );
        expect(recommendations[1]).toMatchObject({
            videoId: 'def456uvw_01',
            surface: 'shorts-overlay',
        });
    });

    it('enforces recommendation cap and returns empty list for malformed metrics', () => {
        const capped = extractRecommendationsFromMetrics(
            jsonMetrics([
                { videoId: 'video000001', position: 1 },
                { videoId: 'video000002', position: 2 },
                { videoId: 'video000003', position: 3 },
            ]),
            {
                platform: 'youtube',
                maxRecommendations: 2,
            }
        );

        expect(capped).toHaveLength(2);
        expect(capped.map((row) => row.videoId)).toEqual(['video000001', 'video000002']);

        const malformed = extractRecommendationsFromMetrics(Buffer.from('{not-json', 'utf-8'), {
            platform: 'youtube',
        });
        expect(malformed).toEqual([]);
    });

    it('normalizes Instagram and TikTok IDs from URLs and keeps platform-safe IDs', () => {
        const instagram = extractRecommendationsFromMetrics(
            jsonMetrics([
                { videoId: 'https://www.instagram.com/reel/C9xAbCdEf12/?igsh=abc', position: 1, surface: 'reels rail' },
                { videoId: 'https://www.instagram.com/p/C1ZxYwVuT98/', position: 2, surface: 'related' },
                { videoId: 'bad id !!!', position: 3 },
            ]),
            {
                platform: 'instagram',
                maxRecommendations: 10,
            }
        );

        expect(instagram.map((row) => row.videoId)).toEqual(['C9xAbCdEf12', 'C1ZxYwVuT98']);
        expect(instagram[0].surface).toBe('reels-rail');

        const tiktok = extractRecommendationsFromMetrics(
            jsonMetrics([
                { videoId: 'https://www.tiktok.com/@creator/video/7429012345678901234', position: 1, surface: 'for you next' },
                { videoId: '7429012345678901235', position: 2 },
                { videoId: 'https://www.tiktok.com/@creator/video/not-numeric', position: 3 },
            ]),
            {
                platform: 'tiktok',
                maxRecommendations: 10,
            }
        );

        expect(tiktok.map((row) => row.videoId)).toEqual(['7429012345678901234', '7429012345678901235']);
        expect(tiktok[0].surface).toBe('for-you-next');
    });

    it('supports platform-native fallback id fields and reports dedupe/drop diagnostics', () => {
        const instagramResult = extractRecommendationsWithDiagnostics(
            jsonMetrics([
                { postId: 'C9xAbCdEf12', position: 1, surface: 'reels up next' },
                { shortcode: 'C1ZxYwVuT98', position: 2, surface: 'reels suggestions' },
                { permalink: 'https://www.instagram.com/reel/C4nQwErTy12/?igsh=abc', position: 3, surface: 'reels_up_next' },
                { mediaId: 'C9xAbCdEf12', position: 4, surface: 'related posts' },
                { videoId: 'https://www.instagram.com/reel/Cseed000001/', position: 5, surface: 'reels up next' },
            ]),
            {
                platform: 'instagram',
                sourceVideoId: 'Cseed000001',
                maxRecommendations: 10,
            }
        );

        expect(instagramResult.recommendations.map((row) => row.videoId)).toEqual([
            'C9xAbCdEf12',
            'C1ZxYwVuT98',
            'C4nQwErTy12',
        ]);
        expect(instagramResult.diagnostics.rawRecommendationRows).toBe(5);
        expect(instagramResult.diagnostics.strictRecommendationRows).toBe(3);
        expect(instagramResult.diagnostics.duplicateRecommendationRows).toBe(1);
        expect(instagramResult.diagnostics.dropReasons.duplicateVideoId).toBe(1);
        expect(instagramResult.diagnostics.dropReasons.selfReference).toBe(1);
        expect(instagramResult.recommendations[1].surface).toBe('reels-up-next');

        const tiktokResult = extractRecommendationsWithDiagnostics(
            jsonMetrics([
                { itemId: '7429012345678902234', position: 1, surface: 'for you next' },
                { aweme_id: '7429012345678902235', position: 2, surface: 'fyp-next' },
                { link: 'https://www.tiktok.com/@creator/video/7429012345678902236', position: 3, surface: 'up-next' },
            ]),
            {
                platform: 'tiktok',
                maxRecommendations: 10,
            }
        );

        expect(tiktokResult.recommendations.map((row) => row.videoId)).toEqual([
            '7429012345678902234',
            '7429012345678902235',
            '7429012345678902236',
        ]);
        expect(tiktokResult.recommendations.map((row) => row.surface)).toEqual([
            'for-you-next',
            'for-you-next',
            'for-you-next',
        ]);
    });
});
