import { describe, expect, it } from 'vitest';
import { extractRecommendationsFromMetrics } from '../src/services/recommendationParsing';

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
            },
            {
                videoId: 'abc123XYZ09',
                position: 1,
                title: 'Direct ID',
                channel: 'chan-b',
            },
            {
                videoId: 'https://youtu.be/def456uvw_01?t=42',
                position: 3,
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
});
