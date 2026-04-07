import { describe, expect, it } from 'vitest';
import {
    DataQualityInputError,
    summarizeDataQualityFromSnapshots,
    summarizeDataQualityTrendFromSnapshots,
} from '../src/services/dataQuality';

const recMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
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
                            { videoId: 'targetvid001', position: 1 },
                            { videoId: '@@@invalid@@@', position: 2 },
                            { videoId: 'seedvideo001', position: 3 },
                        ]),
                        positionInFeed: 0,
                    },
                    {
                        videoId: 'midvideo001',
                        creatorHandle: 'creatorB',
                        contentCategories: ['gaming'],
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1 }]),
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
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1 }]),
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
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1 }]),
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
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1 }]),
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
        expect(summary.cohorts.eligibleUsers).toBe(2);
        expect(summary.cohorts.stabilityScore).toBeGreaterThanOrEqual(0);
        expect(summary.cohorts.stabilityScore).toBeLessThanOrEqual(1);
    });

    it('throws a typed error when no snapshots are available', () => {
        expect(() => summarizeDataQualityFromSnapshots('youtube', [], 24)).toThrow(DataQualityInputError);
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
                        engagementMetrics: recMetrics([{ videoId: 'targetvid001', position: 1 }]),
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
                        engagementMetrics: recMetrics([{ videoId: '@@@invalid@@@', position: 1 }]),
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
                        engagementMetrics: recMetrics([{ videoId: 'targetvid003', position: 1 }]),
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
    });
});
