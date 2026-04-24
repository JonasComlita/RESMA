import { describe, expect, it } from 'vitest';
import {
    buildAudienceModel,
    deriveCohortStabilityScore,
    deriveRecommendationQualityGate,
    getRecommendationQualityThresholds,
    type RawAudienceFeedItem,
} from '../src/services/audienceForecast';
import {
    computeCohortDistance,
    computeOppositeDiscoveryFromModel,
    summarizeBubble,
} from '../src/services/oppositeDiscovery';

const jsonMetrics = (recommendations: Array<{ videoId: string; position?: number }>) =>
    Buffer.from(JSON.stringify({ recommendations }), 'utf-8');

function createItem(
    userId: string,
    videoId: string,
    creatorHandle: string,
    contentCategories: string[],
    recommendations: Array<{ videoId: string; position?: number }> = []
): RawAudienceFeedItem {
    return {
        userId,
        videoId,
        creatorHandle,
        contentCategories,
        engagementMetrics: jsonMetrics(recommendations),
    };
}

function createDiscoveryFixture() {
    const items: RawAudienceFeedItem[] = [
        createItem('u1', 'gseed1', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u1', 'gseed2', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u1', 'gseed3', 'streamer-a', ['gaming'], [{ videoId: 'gmid2', position: 1 }]),

        createItem('u2', 'gseed1', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u2', 'gseed2', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u2', 'gseed4', 'streamer-a', ['gaming'], [{ videoId: 'gmid2', position: 1 }]),

        createItem('u3', 'gseed1', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u3', 'gseed5', 'streamer-a', ['gaming'], [{ videoId: 'gmid1', position: 1 }]),
        createItem('u3', 'gseed6', 'streamer-a', ['gaming'], [{ videoId: 'gmid2', position: 1 }]),

        createItem('m1', 'gmid1', 'connector-a', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m1', 'mseed2', 'connector-b', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m1', 'mseed3', 'connector-c', ['mixed'], [{ videoId: 'bridge002', position: 1 }]),

        createItem('m2', 'gmid1', 'connector-d', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m2', 'mseed4', 'connector-e', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m2', 'mseed5', 'connector-f', ['mixed'], [{ videoId: 'bridge002', position: 1 }]),

        createItem('m3', 'gmid1', 'connector-g', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m3', 'mseed6', 'connector-h', ['mixed'], [{ videoId: 'bridge001', position: 1 }]),
        createItem('m3', 'mseed7', 'connector-i', ['mixed'], [{ videoId: 'bridge002', position: 1 }]),

        createItem('b1', 'bridge001', 'beauty-a', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b1', 'bseed2', 'beauty-b', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b1', 'bseed3', 'beauty-c', ['beauty'], [{ videoId: 'oppo002', position: 1 }]),

        createItem('b2', 'bridge001', 'beauty-d', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b2', 'bseed4', 'beauty-e', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b2', 'bseed5', 'beauty-f', ['beauty'], [{ videoId: 'oppo002', position: 1 }]),

        createItem('b3', 'bridge001', 'beauty-g', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b3', 'bseed6', 'beauty-h', ['beauty'], [{ videoId: 'oppo001', position: 1 }]),
        createItem('b3', 'bseed7', 'beauty-i', ['beauty'], [{ videoId: 'oppo002', position: 1 }]),
    ];

    const model = buildAudienceModel(items, 'youtube');
    const thresholds = getRecommendationQualityThresholds('youtube');
    const qualityGate = deriveRecommendationQualityGate(items, 'youtube', {
        comparedUsers: model.userProfiles.size,
        cohortStabilityScore: deriveCohortStabilityScore(model, thresholds.minimumCohortUsersForLift),
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
    });

    return { model, qualityGate };
}

describe('Opposite discovery service', () => {
    it('summarizes narrow bubbles using the documented thresholds', () => {
        const { model } = createDiscoveryFixture();
        const currentUser = model.userProfiles.get('u1')!;

        const bubble = summarizeBubble(currentUser);

        expect(bubble.level).toBe('high');
        expect(bubble.score).toBeGreaterThanOrEqual(0.7);
        expect(bubble.topCategoryShare).toBe(1);
        expect(bubble.topCreatorShare).toBe(1);
    });

    it('scores distant cohorts higher when category and transition overlap are low', () => {
        const { model } = createDiscoveryFixture();
        const currentUser = model.userProfiles.get('u1')!;
        const oppositeBeauty = Array.from(model.cohorts.values()).find((cohort) => cohort.dominantCategory === 'beauty')!;
        const closerMixed = Array.from(model.cohorts.values()).find((cohort) => cohort.dominantCategory === 'mixed')!;

        const beautyDistance = computeCohortDistance(currentUser, oppositeBeauty);
        const mixedDistance = computeCohortDistance(currentUser, closerMixed);

        expect(beautyDistance.distanceScore).toBeGreaterThan(mixedDistance.distanceScore);
        expect(beautyDistance.videoOverlap).toBeLessThan(mixedDistance.videoOverlap);
    });

    it('finds unseen candidates and bridge content without exposing raw users', () => {
        const { model, qualityGate } = createDiscoveryFixture();
        const currentUser = model.userProfiles.get('u1')!;

        const result = computeOppositeDiscoveryFromModel(model, currentUser, 'youtube', qualityGate, 10);

        expect(result.oppositeCohorts.length).toBeGreaterThan(0);
        expect(result.oppositeCohorts[0].dominantCategory).toBe('beauty');
        expect(result.candidates.some((candidate) => candidate.videoId === 'oppo001')).toBe(true);
        expect(result.candidates.every((candidate) => !currentUser.seenVideos.has(candidate.videoId))).toBe(true);
        expect(result.bridgeContent.some((bridge) => bridge.bestPath.join('->') === 'gmid1->bridge001->oppo001')).toBe(true);
        expect(result.qualityGate.status).toBeDefined();
    });

    it('propagates degraded quality gates while still returning discovery results', () => {
        const { model } = createDiscoveryFixture();
        const currentUser = model.userProfiles.get('u1')!;
        const degradedQualityGate = deriveRecommendationQualityGate([
            createItem('solo-user', 'seed001', 'creator-a', ['gaming'], [{ videoId: 'bad@@@id', position: 1 } as any]),
        ], 'youtube', {
            comparedUsers: 1,
            cohortStabilityScore: 0.2,
        });

        const result = computeOppositeDiscoveryFromModel(model, currentUser, 'youtube', degradedQualityGate, 10);

        expect(result.qualityGate.status).toBe('degraded');
        expect(result.oppositeCohorts.length).toBeGreaterThan(0);
        expect(result.diversityGap.distantCohortCount).toBeGreaterThan(0);
    });
});
