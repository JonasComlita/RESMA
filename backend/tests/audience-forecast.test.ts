import { describe, expect, it } from 'vitest';
import {
    buildAudienceModel,
    computeAudienceForecastFromModel,
    computeReachProbability,
    deriveCohortLiftStabilityEvidence,
    deriveRecommendationQualityGate,
    getRecommendationQualityThresholds,
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
        expect(gate.reasonCodes).toContain('parse_coverage_below_minimum');
        expect(gate.confidenceMultiplier).toBeLessThan(1);
    });

    it('degrades lift interpretation when compared-user and stability gates fail', () => {
        const gate = deriveRecommendationQualityGate([
            {
                userId: 'u1',
                videoId: 'seed001',
                creatorHandle: 'creatorA',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([{ videoId: 'target001', position: 1 }]),
            },
        ], 'youtube', {
            comparedUsers: 1,
            cohortStabilityScore: 0.2,
        });

        expect(gate.status).toBe('degraded');
        expect(gate.canInterpretLift).toBe(false);
        expect(gate.reasonCodes).toContain('compared_users_below_minimum');
        expect(gate.reasonCodes).toContain('cohort_stability_below_minimum');
    });

    it('degrades low-volume windows even when parse coverage is perfect', () => {
        const gate = deriveRecommendationQualityGate([
            {
                userId: 'u1',
                videoId: 'Cseed001',
                creatorHandle: 'creatorA',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([{ postId: 'Ctarget001', position: 1 } as any]),
            },
            {
                userId: 'u2',
                videoId: 'Cseed002',
                creatorHandle: 'creatorB',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([{ postId: 'Ctarget002', position: 1 } as any]),
            },
            {
                userId: 'u3',
                videoId: 'Cseed003',
                creatorHandle: 'creatorC',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([{ postId: 'Ctarget003', position: 1 } as any]),
            },
        ], 'instagram');

        expect(gate.parseCoverage).toBe(1);
        expect(gate.strictRecommendationRows).toBe(3);
        expect(gate.status).toBe('degraded');
        expect(gate.reasonCodes).toContain('strict_rows_below_minimum');
        expect(gate.confidenceMultiplier).toBeLessThan(1);
    });

    it('uses documented platform coverage thresholds for recommendation quality gates', () => {
        const youtube = getRecommendationQualityThresholds('youtube');
        const instagram = getRecommendationQualityThresholds('instagram');
        const tiktok = getRecommendationQualityThresholds('tiktok');

        expect(youtube.minimumParseCoverage).toBeGreaterThanOrEqual(0.2);
        expect(instagram.minimumParseCoverage).toBe(0.2);
        expect(tiktok.minimumParseCoverage).toBe(0.2);
        expect(instagram.minimumStrictRecommendationRows).toBe(6);
        expect(tiktok.minimumStrictRecommendationRows).toBe(6);
    });

    it('builds transitions with platform-aware parsing for Instagram and TikTok', () => {
        const instagramModel = buildAudienceModel([
            {
                userId: 'ig-u1',
                videoId: 'C_seed001',
                creatorHandle: 'igCreator',
                contentCategories: ['reels'],
                engagementMetrics: jsonMetrics([
                    { postId: 'C_target001' } as any,
                    { permalink: 'https://www.instagram.com/reel/C_target002/' } as any,
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
        const instagramSecondEdge = instagramModel.userProfiles.get('ig-u1')
            ?.transitionCounts.get('C_seed001')
            ?.get('C_target002');
        expect(instagramSecondEdge).toBeGreaterThan(0);

        const tiktokModel = buildAudienceModel([
            {
                userId: 'tt-u1',
                videoId: '7429000000000000001',
                creatorHandle: 'ttCreator',
                contentCategories: ['for-you'],
                engagementMetrics: jsonMetrics([
                    { itemId: '7429000000000000002' } as any,
                    { aweme_id: '7429000000000000003' } as any,
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
        const tiktokSecondEdge = tiktokModel.userProfiles.get('tt-u1')
            ?.transitionCounts.get('7429000000000000001')
            ?.get('7429000000000000003');
        expect(tiktokSecondEdge).toBeGreaterThan(0);
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

    it('gates lift interpretation when cohort evidence is below minimum sample constraints', () => {
        const model = buildAudienceModel([
            {
                userId: 'g1',
                videoId: 'seed1',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target1', position: 1 }]),
            },
            {
                userId: 'g1',
                videoId: 'side1',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'g1',
                videoId: 'side2',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'g2',
                videoId: 'seed1',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target1', position: 1 }]),
            },
            {
                userId: 'g2',
                videoId: 'side3',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'g2',
                videoId: 'side4',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'b1',
                videoId: 'beauty1',
                creatorHandle: 'beautyA',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([{ videoId: 'beauty2', position: 1 }]),
            },
            {
                userId: 'b1',
                videoId: 'beauty2',
                creatorHandle: 'beautyB',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
            {
                userId: 'b1',
                videoId: 'beauty3',
                creatorHandle: 'beautyC',
                contentCategories: ['beauty'],
                engagementMetrics: jsonMetrics([]),
            },
        ]);

        const forecast = computeAudienceForecastFromModel(model, 'g1', {
            targetVideoId: 'target1',
            seedVideoId: 'seed1',
            platform: 'youtube',
            maxDepth: 3,
            beamWidth: 30,
        });

        const gated = forecast.cohorts.find((cohort) => !cohort.liftInterpretation.isLiftInterpretable);
        expect(gated).toBeDefined();
        expect(gated?.relativeLiftVsGlobalExposure).toBeNull();
        expect(gated?.liftInterpretation.gateReasons.length).toBeGreaterThan(0);
    });

    it('derives adjacent-window lift stability evidence when capture timestamps exist', () => {
        const items = [
            {
                userId: 'u1',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
                capturedAt: new Date('2026-04-07T01:00:00.000Z'),
            },
            {
                userId: 'u1',
                videoId: 'side1',
                creatorHandle: 'creatorB',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T01:00:30.000Z'),
            },
            {
                userId: 'u1',
                videoId: 'side2',
                creatorHandle: 'creatorC',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T01:01:00.000Z'),
            },
            {
                userId: 'u2',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T02:00:00.000Z'),
            },
            {
                userId: 'u2',
                videoId: 'side3',
                creatorHandle: 'creatorD',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
                capturedAt: new Date('2026-04-07T02:00:30.000Z'),
            },
            {
                userId: 'u2',
                videoId: 'side4',
                creatorHandle: 'creatorE',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T02:01:00.000Z'),
            },
            {
                userId: 'u3',
                videoId: 'seed',
                creatorHandle: 'creatorA',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([{ videoId: 'target', position: 1 }]),
                capturedAt: new Date('2026-04-07T03:00:00.000Z'),
            },
            {
                userId: 'u3',
                videoId: 'side5',
                creatorHandle: 'creatorF',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T03:00:30.000Z'),
            },
            {
                userId: 'u3',
                videoId: 'side6',
                creatorHandle: 'creatorG',
                contentCategories: ['gaming'],
                engagementMetrics: jsonMetrics([]),
                capturedAt: new Date('2026-04-07T03:01:00.000Z'),
            },
        ];

        const model = buildAudienceModel(items);
        const stability = deriveCohortLiftStabilityEvidence(items, model, 'target');
        expect(stability.size).toBeGreaterThan(0);
        const first = Array.from(stability.values())[0];
        expect(first.adjacentWindowUsers.earlier).toBeGreaterThan(0);
        expect(first.adjacentWindowUsers.later).toBeGreaterThan(0);
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
