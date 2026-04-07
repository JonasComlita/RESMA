import { describe, expect, it } from 'vitest';
import {
    DataQualityInputError,
    summarizeDataQualityFromSnapshots,
    summarizeDataQualityTrendFromSnapshots,
} from '../src/services/dataQuality';

const recMetrics = (
    recommendations: Array<{ videoId: string; position?: number; surface?: string }>
) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

describe('Data quality diagnostics', () => {
    it('summarizes dedupe, strict parsing, and cohort stability from snapshots', () => {
        const snapshots = [
            {
                id: 's1',
                userId: 'u1',
                capturedAt: new Date('2026-04-07T01:00:00.000Z'),
                sessionMetadata: Buffer.from(JSON.stringify({ quality: { fingerprintHash: 'h1', stitchedSessionKey: 'k1' } })),
                feedItems: [
                    {
                        videoId: 'seedvideo001',
                        creatorHandle: 'creatorA',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([
                            { videoId: 'targetvid001', position: 1, surface: 'watch-next-sidebar' },
                            { videoId: '@@@invalid@@@', position: 2, surface: 'end-screen-overlay' },
                            { videoId: 'seedvideo001', position: 3, surface: 'watch-next-sidebar' },
                        ]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'midvideo001',
                        creatorHandle: 'creatorB',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1, surface: 'watch-next-sidebar' }]),
                        positionInFeed: 1,
                    },
                ],
            },
            {
                id: 's2',
                userId: 'u1',
                capturedAt: new Date('2026-04-07T01:00:30.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo001',
                        creatorHandle: 'creatorA',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1, surface: 'watch-next-sidebar' }]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'midvideo001',
                        creatorHandle: 'creatorB',
                        contentCategories: ['gaming'],
                        engagementMetrics: null,
                        positionInFeed: 1,
                    },
                ],
            },
            {
                id: 's3',
                userId: 'u1',
                capturedAt: new Date('2026-04-07T01:45:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'tailvideo001',
                        creatorHandle: 'creatorC',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1, surface: 'shorts-overlay' }]),
                        positionInFeed: 0,
                    },
                ],
            },
            {
                id: 's4',
                userId: 'u2',
                capturedAt: new Date('2026-04-07T01:01:00.000Z'),
                sessionMetadata: Buffer.from(JSON.stringify({ quality: { fingerprintHash: 'h2', stitchedSessionKey: 'k2' } })),
                feedItems: [
                    {
                        videoId: 'seedvideo002',
                        creatorHandle: 'creatorA',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1, surface: 'watch-next-sidebar' }]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'sidevideo002',
                        creatorHandle: 'creatorD',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 1,
                    },
                    {
                        videoId: 'endvideo002',
                        creatorHandle: 'creatorE',
                        contentCategories: ['gaming'],
                        engagementMetrics: null,
                        positionInFeed: 2,
                    },
                ],
            },
        ];

        const summary = summarizeDataQualityFromSnapshots('youtube', snapshots, 24);

        expect(summary.totals.snapshots).toBe(4);
        expect(summary.stitching.dedupedSnapshots).toBe(1);
        expect(summary.stitching.snapshotsAfterDedupe).toBe(3);
        expect(summary.stitching.stitchedSessions).toBe(3);
        expect(summary.recommendations.rawRecommendationRows).toBeGreaterThan(0);
        expect(summary.recommendations.strictRecommendationRows).toBeGreaterThan(0);
        expect(summary.recommendations.parserDropRate).toBeGreaterThan(0);
        expect(summary.recommendations.bySurface.length).toBeGreaterThan(0);
        expect(summary.recommendations.bySurface.some((surface) => surface.surface === 'watch-next-sidebar')).toBe(true);
        expect(summary.recommendations.surfaceTransitionStability).toBeGreaterThanOrEqual(0);
        expect(summary.recommendations.surfaceTransitionStability).toBeLessThanOrEqual(1);
        expect(summary.cohorts.eligibleUsers).toBe(2);
        expect(summary.cohorts.stabilityScore).toBeGreaterThanOrEqual(0);
        expect(summary.cohorts.stabilityScore).toBeLessThanOrEqual(1);
    });

    it('throws a typed error when no snapshots are available', () => {
        expect(() => summarizeDataQualityFromSnapshots('youtube', [], 24)).toThrow(DataQualityInputError);
    });

    it('parses recommendation rows for Instagram and TikTok platform IDs', () => {
        const instagramSnapshots = [
            {
                id: 'ig-1',
                userId: 'ig-u1',
                capturedAt: new Date('2026-04-07T04:00:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'Cseed0001',
                        creatorHandle: 'ig-a',
                        contentCategories: ['reels'],
                        engagementMetrics: recMetrics([
                            { videoId: 'https://www.instagram.com/reel/Ctarget0001/', position: 1, surface: 'reels-up-next' },
                        ]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'Cside0001',
                        creatorHandle: 'ig-b',
                        contentCategories: ['reels'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 1,
                    },
                    {
                        videoId: 'Cside0002',
                        creatorHandle: 'ig-c',
                        contentCategories: ['reels'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 2,
                    },
                ],
            },
        ];

        const instagramSummary = summarizeDataQualityFromSnapshots('instagram', instagramSnapshots, 24);
        expect(instagramSummary.recommendations.strictRecommendationRows).toBeGreaterThan(0);
        expect(instagramSummary.recommendations.parseCoverage).toBeGreaterThan(0);

        const tiktokSnapshots = [
            {
                id: 'tt-1',
                userId: 'tt-u1',
                capturedAt: new Date('2026-04-07T04:10:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: '7429000000000000001',
                        creatorHandle: 'tt-a',
                        contentCategories: ['for-you'],
                        engagementMetrics: recMetrics([
                            { videoId: 'https://www.tiktok.com/@creator/video/7429000000000000002', position: 1, surface: 'for-you-next' },
                        ]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: '7429000000000000010',
                        creatorHandle: 'tt-b',
                        contentCategories: ['for-you'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 1,
                    },
                    {
                        videoId: '7429000000000000011',
                        creatorHandle: 'tt-c',
                        contentCategories: ['for-you'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 2,
                    },
                ],
            },
        ];

        const tiktokSummary = summarizeDataQualityFromSnapshots('tiktok', tiktokSnapshots, 24);
        expect(tiktokSummary.recommendations.strictRecommendationRows).toBeGreaterThan(0);
        expect(tiktokSummary.recommendations.bySurface.some((surface) => surface.surface === 'for-you-next')).toBe(true);
    });

    it('keeps stitched sessions stable across large time gaps when metadata session keys match', () => {
        const snapshots = [
            {
                id: 's1',
                userId: 'u1',
                capturedAt: new Date('2026-04-07T01:00:00.000Z'),
                sessionMetadata: Buffer.from(JSON.stringify({
                    quality: {
                        fingerprintHash: 'same-hash-a',
                        stitchedSessionKey: 'youtube:user1:stable-session',
                    },
                })),
                feedItems: [
                    {
                        videoId: 'seedvideo001',
                        creatorHandle: 'creatorA',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'target001', position: 1 }]),
                        positionInFeed: 0,
                    },
                ],
            },
            {
                id: 's2',
                userId: 'u1',
                capturedAt: new Date('2026-04-07T03:30:00.000Z'),
                sessionMetadata: Buffer.from(JSON.stringify({
                    quality: {
                        fingerprintHash: 'same-hash-b',
                        stitchedSessionKey: 'youtube:user1:stable-session',
                    },
                })),
                feedItems: [
                    {
                        videoId: 'seedvideo002',
                        creatorHandle: 'creatorB',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'target002', position: 1 }]),
                        positionInFeed: 0,
                    },
                ],
            },
            {
                id: 's3',
                userId: 'u2',
                capturedAt: new Date('2026-04-07T03:40:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo003',
                        creatorHandle: 'creatorC',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'target003', position: 1 }]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'sidevideo003',
                        creatorHandle: 'creatorD',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 1,
                    },
                    {
                        videoId: 'tailvideo003',
                        creatorHandle: 'creatorE',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 2,
                    },
                ],
            },
            {
                id: 's4',
                userId: 'u3',
                capturedAt: new Date('2026-04-07T03:50:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo004',
                        creatorHandle: 'creatorF',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'target004', position: 1 }]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'sidevideo004',
                        creatorHandle: 'creatorG',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 1,
                    },
                    {
                        videoId: 'tailvideo004',
                        creatorHandle: 'creatorH',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([]),
                        positionInFeed: 2,
                    },
                ],
            },
        ];

        const summary = summarizeDataQualityFromSnapshots('youtube', snapshots, 24);

        expect(summary.stitching.stitchedSessions).toBe(3);
        expect(summary.stitching.snapshotsWithStitchedSessionKey).toBe(2);
    });

    it('builds time-bucketed trend points for quality drift tracking', () => {
        const snapshots = [
            {
                id: 's1',
                userId: 'u1',
                capturedAt: new Date('2026-04-06T00:10:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo001',
                        creatorHandle: 'creatorA',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1, surface: 'watch-next-sidebar' }]),
                        positionInFeed: 0,
                    },
                ],
            },
            {
                id: 's2',
                userId: 'u1',
                capturedAt: new Date('2026-04-06T13:10:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo002',
                        creatorHandle: 'creatorB',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: '@@@invalid@@@', position: 1, surface: 'end-screen-overlay' }]),
                        positionInFeed: 0,
                    },
                ],
            },
            {
                id: 's3',
                userId: 'u2',
                capturedAt: new Date('2026-04-07T09:10:00.000Z'),
                sessionMetadata: null,
                feedItems: [
                    {
                        videoId: 'seedvideo003',
                        creatorHandle: 'creatorC',
                        contentCategories: ['beauty'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid003', position: 1, surface: 'shorts-overlay' }]),
                        positionInFeed: 0,
                    },
                ],
            },
        ];

        const trend = summarizeDataQualityTrendFromSnapshots('youtube', snapshots, 72, 24);
        expect(trend.points.length).toBe(2);
        expect(trend.bucketHours).toBe(24);
        expect(trend.points[0].snapshots).toBe(2);
        expect(trend.points[1].snapshots).toBe(1);
        expect(trend.points[0].surfaceMetrics.length).toBeGreaterThan(0);
        expect(trend.points[0].surfaceMetrics.some((entry) => entry.surface === 'watch-next-sidebar')).toBe(true);
    });
});
