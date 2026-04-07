import { describe, expect, it } from 'vitest';
import {
    buildAudienceModel,
    computeAudienceForecastFromModel,
    computeReachProbability,
    deriveRecommendationQualityGate,
} from '../src/services/audienceForecast';

const jsonMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

describe('Audience forecast service', () => {
    it('marks quality gate degraded when strict parsing coverage is low', () => {
        const gate = deriveRecommendationQualityGate([
            {
                userId: 'u1',
                videoId: 'seed001',
                creatorHandle: 'creatorA',
                contentCategories: ['reels'],
                engagementMetrics: Buffer.from(JSON.stringify({
                    recommendations: [
                        { videoId: '***invalid***' },
                        { videoId: '' },
                    ],
                }), 'utf-8'),
            },
        ], 'instagram');

        expect(gate.status).toBe('degraded');
        expect(gate.parseCoverage).toBe(0);
        expect(gate.confidenceMultiplier).toBeLessThan(1);
    });

    it('builds transitions with platform-aware parsing for Instagram and TikTok', () => {
        const instagramModel = buildAudienceModel([
            {
                userId: 'ig-u1',
                videoId: 'C_seed001',
                creatorHandle: 'igCreator',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([
                    { videoId: 'https://www.instagram.com/reel/C_target001/' },
                ]),
            },
            {
                userId: 'ig-u1',
                videoId: 'C_side001',
                creatorHandle: 'igCreator2',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'ig-u1',
                videoId: 'C_side002',
                creatorHandle: 'igCreator3',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([]),
            },
        ], 'instagram');

        const instagramEdge = instagramModel.userProfiles.get('ig-u1')
            ?.transitionCounts.get('C_seed001')
            ?.get('C_target001');
        expect(instagramEdge).toBeGreaterThan(0);

        const tiktokModel = buildAudienceModel([
            {
                userId: 'tt-u1',
                videoId: '7429000000000000001',
                creatorHandle: 'ttCreator',
                contentCategories: ['for-you'],
                engagementMetrics: jsonMetrics([
                    { videoId: 'https://www.tiktok.com/@creator/video/7429000000000000002' },
                ]),
            },
            {
                userId: 'tt-u1',
                videoId: '7429000000000000010',
                creatorHandle: 'ttCreator2',
                contentCategories: ['for-you'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'tt-u1',
                videoId: '7429000000000000011',
                creatorHandle: 'ttCreator3',
                contentCategories: ['for-you'],
                engagementMetrics: jsonMetrics([]),
            },
        ], 'tiktok');

        const tiktokEdge = tiktokModel.userProfiles.get('tt-u1')
            ?.transitionCounts.get('7429000000000000001')
            ?.get('7429000000000000002');
        expect(tiktokEdge).toBeGreaterThan(0);
    });

    it('prioritizes cohorts where target video is more likely and better fit', () => {
        const model = buildAudienceModel([
            {
                userId: 'u1',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([
                    { videoId: 'mid', position: 1 },
                    { videoId: 'target', position: 2 },
                ]),
            },
            {
                userId: 'u1',
                videoId: 'mid',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u1',
                videoId: 'bonus1',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'side',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 2 }]),
            },
            {
                userId: 'u2',
                videoId: 'bonus2',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u4',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u4',
                videoId: 'mid2',
                creatorHandle: 'creatorF',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
            },
            {
                userId: 'u4',
                videoId: 'bonus4',
                creatorHandle: 'creatorG',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 2 }]),
            },
            {
                userId: 'u3',
                videoId: 'seed',
                creatorHandle: 'beautyCreator',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'beautyVid', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'beautyVid',
                creatorHandle: 'beautyCreator',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'seed', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'beautyExtra',
                creatorHandle: 'beautyCreator2',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'beautyVid', position: 1 }]),
            },
        ]);

        const forecast = computeAudienceForecastFromModel(model, 'u1', {
            targetVideoId: 'target',
            seedVideoId: 'seed',
            platform: 'youtube',
            maxDepth: 3,
            beamWidth: 30,
        });

        expect(forecast.networkEffect.comparedUsers).toBe(4);
        expect(forecast.global.targetExposureRate).toBeGreaterThan(0.5);
        expect(forecast.recommendedAudienceCohorts.length).toBeGreaterThan(0);

        const topCohort = forecast.recommendedAudienceCohorts[0];
        expect(topCohort.cohortLabel).toContain('gaming');
        expect(topCohort.reachProbabilityFromSeed ?? 0).toBeGreaterThan(0.6);
        expect(topCohort.fitScore).toBeGreaterThan(0.6);
    });

    it('computes reach probability through multi-step paths', () => {
        const transitionMap = new Map<string, Array<{ toVideoId: string; count: number; probability: number }>>([
            ['A', [
                { toVideoId: 'B', count: 7, probability: 0.7 },
                { toVideoId: 'X', count: 3, probability: 0.3 },
            ]],
            ['B', [{ toVideoId: 'C', count: 8, probability: 0.8 }]],
            ['X', [{ toVideoId: 'C', count: 2, probability: 0.2 }]],
        ]);

        const reach = computeReachProbability(transitionMap, 'A', 'C', 3, 20);
        expect(reach).toBeGreaterThan(0.5);
        expect(reach).toBeLessThan(1);
    });

    it('downweights repeated transitions within a session and resets by session', () => {
        const model = buildAudienceModel([
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'sidevid001',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s1',
                videoId: 'sidevid002',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u1',
                sessionId: 'u1:s2',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
        ]);

        const userProfile = model.userProfiles.get('u1');
        expect(userProfile).toBeDefined();

        const transitionWeight = userProfile?.transitionCounts.get('seedvid001')?.get('targetvid01') ?? 0;
        expect(transitionWeight).toBeCloseTo(2.833, 3);
        expect(model.totalTransitions).toBeCloseTo(2.833, 3);
    });

    it('falls back sparse cohorts to mixed to reduce unstable fragmentation', () => {
        const model = buildAudienceModel([
            {
                userId: 'u1',
                videoId: 'seedvid001',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u1',
                videoId: 'sidevid001',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u1',
                videoId: 'sidevid002',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u2',
                videoId: 'seedvid002',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u2',
                videoId: 'sidevid003',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u2',
                videoId: 'sidevid004',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u3',
                videoId: 'seedvid003',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'targetvid01', position: 1 }]),
            },
            {
                userId: 'u3',
                videoId: 'sidevid005',
                creatorHandle: 'creatorF',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u3',
                videoId: 'sidevid006',
                creatorHandle: 'creatorG',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u4',
                videoId: 'beauty001',
                creatorHandle: 'beautyCreator',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'beauty002', position: 1 }]),
            },
            {
                userId: 'u4',
                videoId: 'beauty002',
                creatorHandle: 'beautyCreator2',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'u4',
                videoId: 'beauty003',
                creatorHandle: 'beautyCreator3',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
        ]);

        const beautyUser = model.userProfiles.get('u4');
        expect(beautyUser).toBeDefined();
        expect(beautyUser?.cohortId.startsWith('mixed|')).toBe(true);

        const hasSparseBeautyCohort = Array.from(model.cohorts.keys()).some((cohortId) =>
            cohortId.startsWith('beauty|')
        );
        expect(hasSparseBeautyCohort).toBe(false);
    });
});
