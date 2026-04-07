import { describe, expect, it } from 'vitest';
import { buildAudienceModel } from '../src/services/audienceForecast';
import { buildGoToMarketCohortBriefFromModel } from '../src/services/goToMarketBrief';

const jsonMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

const healthyQualityGate = {
    status: 'ok' as const,
    parseCoverage: 0.9,
    parserDropRate: 0.1,
    minimumParseCoverage: 0.2,
    confidenceMultiplier: 1,
};

describe('Go-to-market cohort brief', () => {
    it('exports top cohorts with lift, confidence bands, and predicted reach paths', () => {
        const model = buildAudienceModel([
            {
                userId: 'u1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([
                    { videoId: 'midvid001', position: 1 },
                    { videoId: 'target001', position: 2 },
                ]),
            },
            {
                userId: 'u1',
                videoId: 'midvid001',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u1',
                videoId: 'sideu1001',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u2',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'sideu2001',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'sideu2002',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u3',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'midvid001', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'midvid001',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'sideu3001',
                creatorHandle: 'creatorF',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u4',
                videoId: 'beauty001',
                creatorHandle: 'beautyA',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'beauty002', position: 1 }]),
            },
            {
                userId: 'u4',
                videoId: 'beauty002',
                creatorHandle: 'beautyB',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u4',
                videoId: 'beauty003',
                creatorHandle: 'beautyC',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
        ]);

        const brief = buildGoToMarketCohortBriefFromModel(
            model,
            'u1',
            {
                targetVideoId: 'target001',
                seedVideoId: 'seedvid001',
                platform: 'youtube',
                maxDepth: 3,
                beamWidth: 30,
            },
            healthyQualityGate,
            {
                topCohorts: 5,
                maxPathsPerCohort: 3,
                pathBranchLimit: 6,
            }
        );

        expect(brief.topCohorts.length).toBeGreaterThan(0);
        expect(brief.topCohorts[0].relativeLiftVsGlobalExposure).not.toBeNull();
        expect(brief.topCohorts[0].predictedReachPaths.length).toBeGreaterThan(0);
        expect(
            brief.topCohorts[0].predictedReachPaths.some((path) =>
                path.pathVideoIds[path.pathVideoIds.length - 1] === 'target001'
            )
        ).toBe(true);
        expect(brief.markdown).toContain('Go-to-Market Cohort Brief');
        expect(brief.markdown).toContain('Lift vs Global');
    });

    it('still exports confidence bands when no seed is provided', () => {
        const model = buildAudienceModel([
            {
                userId: 'u1',
                videoId: 'seedaaa111',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u1',
                videoId: 'sideaaa11',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u1',
                videoId: 'sideaaa12',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u2',
                videoId: 'seedaaa111',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'sidebbb11',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u2',
                videoId: 'sidebbb12',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u3',
                videoId: 'seedaaa111',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'sideccc11',
                creatorHandle: 'creatorF',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u3',
                videoId: 'sideccc12',
                creatorHandle: 'creatorG',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
        ]);

        const brief = buildGoToMarketCohortBriefFromModel(model, 'u1', {
            targetVideoId: 'target001',
            platform: 'youtube',
            maxDepth: 3,
            beamWidth: 30,
        }, healthyQualityGate);

        expect(brief.seedVideoId).toBeNull();
        expect(brief.topCohorts.every((cohort) => cohort.predictedReachPaths.length === 0)).toBe(true);
        expect(brief.markdown).toContain('Exposure (CI)');
        expect(brief.keyTakeaways.some((line) => line.includes('Add a seed video ID'))).toBe(true);
    });
});
