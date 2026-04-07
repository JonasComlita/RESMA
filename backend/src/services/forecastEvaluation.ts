import {
    AudienceForecastInputError,
    buildAudienceModel,
    RawAudienceFeedItem,
} from './audienceForecast.js';
import { extractRecommendationsFromMetrics } from './recommendationParsing.js';

let prismaClientPromise: Promise<any> | null = null;

async function getPrismaClient() {
    if (!prismaClientPromise) {
        prismaClientPromise = import('../lib/prisma.js').then((module) => module.prisma);
    }
    return prismaClientPromise;
}

interface RecommendationEdge {
    toVideoId: string;
    probability: number;
}

type TransitionProbabilityMap = Map<string, RecommendationEdge[]>;

interface EvaluationCase {
    userId: string;
    sourceVideoId: string;
    actualTargets: Set<string>;
    cohortId: string | null;
}

export interface TransitionEvaluationMetrics {
    topK: number;
    sampleSize: number;
    topKReachHitRate: number;
    precisionAtK: number;
    calibrationScore: number;
    reliabilityScore: number;
}

export interface CohortEvaluationMetrics extends TransitionEvaluationMetrics {
    cohortId: string;
    users: number;
}

export interface ForecastEvaluationResult {
    platform: string;
    split: {
        trainSnapshots: number;
        testSnapshots: number;
        trainItems: number;
        testCases: number;
    };
    metrics: TransitionEvaluationMetrics;
    cohortMetrics: CohortEvaluationMetrics[];
    generatedAt: string;
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function extractRecommendations(
    metrics: Buffer | null,
    platform: string
): Array<{ videoId: string; position: number }> {
    return extractRecommendationsFromMetrics(metrics, {
        platform,
        maxRecommendations: 40,
    });
}

function normalizeTransitions(
    transitionCounts: Map<string, Map<string, number>>
): TransitionProbabilityMap {
    const normalized = new Map<string, RecommendationEdge[]>();

    for (const [sourceVideoId, targets] of transitionCounts.entries()) {
        let total = 0;
        for (const count of targets.values()) {
            total += count;
        }

        if (total <= 0) continue;

        const edges: RecommendationEdge[] = [];
        for (const [targetVideoId, count] of targets.entries()) {
            edges.push({
                toVideoId: targetVideoId,
                probability: count / total,
            });
        }

        edges.sort((a, b) => b.probability - a.probability);
        normalized.set(sourceVideoId, edges);
    }

    return normalized;
}

export function evaluateTransitionPredictor(
    cases: EvaluationCase[],
    transitions: TransitionProbabilityMap,
    topK: number
): TransitionEvaluationMetrics {
    let considered = 0;
    let hitCases = 0;
    let precisionTotal = 0;

    let brierSum = 0;
    let brierCount = 0;

    for (const evaluationCase of cases) {
        const predictions = transitions.get(evaluationCase.sourceVideoId)?.slice(0, topK) ?? [];
        if (predictions.length === 0) continue;

        considered += 1;
        let hits = 0;

        for (const prediction of predictions) {
            const observed = evaluationCase.actualTargets.has(prediction.toVideoId) ? 1 : 0;
            if (observed) {
                hits += 1;
            }

            brierSum += (prediction.probability - observed) ** 2;
            brierCount += 1;
        }

        if (hits > 0) {
            hitCases += 1;
        }

        precisionTotal += hits / topK;
    }

    if (considered === 0) {
        return {
            topK,
            sampleSize: 0,
            topKReachHitRate: 0,
            precisionAtK: 0,
            calibrationScore: 0,
            reliabilityScore: 0,
        };
    }

    const hitRate = hitCases / considered;
    const precision = precisionTotal / considered;
    const brier = brierCount > 0 ? brierSum / brierCount : 1;
    const calibrationScore = 1 - clamp(brier / 0.25, 0, 1);
    const sampleWeight = clamp(considered / 400, 0, 1);
    const base = hitRate * 0.5 + precision * 0.3 + calibrationScore * 0.2;
    const reliabilityScore = base * (0.35 + 0.65 * sampleWeight);

    return {
        topK,
        sampleSize: considered,
        topKReachHitRate: roundTo(hitRate),
        precisionAtK: roundTo(precision),
        calibrationScore: roundTo(calibrationScore),
        reliabilityScore: roundTo(reliabilityScore),
    };
}

function snapshotsToFeedItems(
    snapshots: Array<{
        userId: string;
        feedItems: Array<{
            videoId: string;
            creatorHandle: string | null;
            contentCategories: string[];
            engagementMetrics: Buffer | null;
        }>;
    }>
): RawAudienceFeedItem[] {
    const items: RawAudienceFeedItem[] = [];

    for (const snapshot of snapshots) {
        for (const feedItem of snapshot.feedItems) {
            items.push({
                userId: snapshot.userId,
                videoId: feedItem.videoId,
                creatorHandle: feedItem.creatorHandle,
                contentCategories: feedItem.contentCategories,
                engagementMetrics: feedItem.engagementMetrics,
            });
        }
    }

    return items;
}

function snapshotsToEvaluationCases(
    snapshots: Array<{
        userId: string;
        feedItems: Array<{
            videoId: string;
            engagementMetrics: Buffer | null;
        }>;
    }>,
    userCohorts: Map<string, string>,
    platform: string,
    topK: number
): EvaluationCase[] {
    const cases: EvaluationCase[] = [];

    for (const snapshot of snapshots) {
        const cohortId = userCohorts.get(snapshot.userId) ?? null;
        for (const feedItem of snapshot.feedItems) {
            const sourceVideoId = sanitizeString(feedItem.videoId);
            if (!sourceVideoId) continue;

            const recommendations = extractRecommendations(feedItem.engagementMetrics, platform)
                .slice(0, topK * 2)
                .map((recommendation) => recommendation.videoId);

            if (recommendations.length === 0) continue;

            cases.push({
                userId: snapshot.userId,
                sourceVideoId,
                actualTargets: new Set(recommendations),
                cohortId,
            });
        }
    }

    return cases;
}

export async function generateForecastEvaluation(
    platform: string,
    topK = 5
): Promise<ForecastEvaluationResult> {
    const boundedTopK = clamp(Math.round(topK), 1, 20);
    const prisma = await getPrismaClient();
    const snapshots = await prisma.feedSnapshot.findMany({
        where: { platform },
        select: {
            userId: true,
            capturedAt: true,
            feedItems: {
                select: {
                    videoId: true,
                    creatorHandle: true,
                    contentCategories: true,
                    engagementMetrics: true,
                },
            },
        },
        orderBy: { capturedAt: 'asc' },
        take: 2000,
    });

    if (snapshots.length < 12) {
        throw new AudienceForecastInputError(
            `Not enough ${platform} snapshots for holdout evaluation yet.`,
            404,
            { platform, minimumSnapshots: 12 }
        );
    }

    const splitIndex = clamp(Math.floor(snapshots.length * 0.8), 1, snapshots.length - 1);
    const trainSnapshots = snapshots.slice(0, splitIndex);
    const testSnapshots = snapshots.slice(splitIndex);

    const trainItems = snapshotsToFeedItems(trainSnapshots);
    const trainModel = buildAudienceModel(trainItems, platform);

    if (trainModel.userProfiles.size === 0 || trainModel.globalTransitions.size === 0) {
        throw new AudienceForecastInputError(
            `Insufficient ${platform} transition data in training split.`,
            404,
            { platform }
        );
    }

    const userCohorts = new Map<string, string>();
    for (const profile of trainModel.userProfiles.values()) {
        userCohorts.set(profile.userId, profile.cohortId);
    }

    const testCases = snapshotsToEvaluationCases(
        testSnapshots.map((snapshot) => ({
            userId: snapshot.userId,
            feedItems: snapshot.feedItems.map((item) => ({
                videoId: item.videoId,
                engagementMetrics: item.engagementMetrics,
            })),
        })),
        userCohorts,
        platform,
        boundedTopK
    );

    const globalTransitions = normalizeTransitions(trainModel.globalTransitions);
    const globalMetrics = evaluateTransitionPredictor(testCases, globalTransitions, boundedTopK);

    const cohortMetrics: CohortEvaluationMetrics[] = [];
    for (const cohort of trainModel.cohorts.values()) {
        const cohortCases = testCases.filter((evaluationCase) => evaluationCase.cohortId === cohort.cohortId);
        if (cohortCases.length === 0) continue;

        const cohortTransitions = normalizeTransitions(cohort.transitionCounts);
        const metrics = evaluateTransitionPredictor(cohortCases, cohortTransitions, boundedTopK);
        cohortMetrics.push({
            cohortId: cohort.cohortId,
            users: cohort.users.length,
            ...metrics,
        });
    }

    cohortMetrics.sort((a, b) => b.reliabilityScore - a.reliabilityScore || b.sampleSize - a.sampleSize);

    return {
        platform,
        split: {
            trainSnapshots: trainSnapshots.length,
            testSnapshots: testSnapshots.length,
            trainItems: trainItems.length,
            testCases: testCases.length,
        },
        metrics: globalMetrics,
        cohortMetrics,
        generatedAt: new Date().toISOString(),
    };
}
