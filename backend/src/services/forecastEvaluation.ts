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
    windowBucket?: 'earlier' | 'later' | null;
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
    adjacentWindow: AdjacentWindowMetrics;
}

export interface AdjacentWindowMetrics {
    earlierSampleSize: number;
    laterSampleSize: number;
    earlierReliabilityScore: number;
    laterReliabilityScore: number;
    reliabilityDelta: number | null;
}

export interface ReliabilityGate {
    status: 'pass' | 'degraded';
    reasons: string[];
    minimumSampleSize: number;
    minimumReliabilityScore: number;
    maximumAdjacentWindowReliabilityDelta: number;
}

export interface KeyCohortValidation {
    cohortId: string;
    users: number;
    sampleSize: number;
    reliabilityScore: number;
    adjacentWindow: AdjacentWindowMetrics;
    gate: ReliabilityGate;
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
    adjacentWindow: AdjacentWindowMetrics;
    cohortMetrics: CohortEvaluationMetrics[];
    validation: {
        globalGate: ReliabilityGate;
        keyCohortGate: ReliabilityGate;
        keyCohorts: KeyCohortValidation[];
    };
    generatedAt: string;
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

const FORECAST_RELIABILITY_THRESHOLDS = {
    globalMinimumSampleSize: 30,
    globalMinimumReliabilityScore: 0.22,
    keyCohortMinimumSampleSize: 12,
    keyCohortMinimumReliabilityScore: 0.18,
    maximumAdjacentWindowReliabilityDelta: 0.35,
    keyCohortCount: 5,
};

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
        capturedAt: Date;
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
                capturedAt: snapshot.capturedAt,
            });
        }
    }

    return items;
}

function snapshotsToEvaluationCases(
    snapshots: Array<{
        userId: string;
        capturedAt: Date;
        feedItems: Array<{
            videoId: string;
            engagementMetrics: Buffer | null;
        }>;
    }>,
    userCohorts: Map<string, string>,
    platform: string,
    topK: number,
    splitTimestampMs: number | null
): EvaluationCase[] {
    const cases: EvaluationCase[] = [];

    for (const snapshot of snapshots) {
        const cohortId = userCohorts.get(snapshot.userId) ?? null;
        const capturedAtMs = snapshot.capturedAt?.getTime();
        const windowBucket: EvaluationCase['windowBucket'] = (
            splitTimestampMs !== null
            && Number.isFinite(capturedAtMs)
        )
            ? (capturedAtMs <= splitTimestampMs ? 'earlier' : 'later')
            : null;
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
                windowBucket,
            });
        }
    }

    return cases;
}

function deriveAdjacentWindowMetrics(
    cases: EvaluationCase[],
    transitions: TransitionProbabilityMap,
    topK: number
): AdjacentWindowMetrics {
    const earlierCases = cases.filter((evaluationCase) => evaluationCase.windowBucket === 'earlier');
    const laterCases = cases.filter((evaluationCase) => evaluationCase.windowBucket === 'later');
    const earlierMetrics = evaluateTransitionPredictor(earlierCases, transitions, topK);
    const laterMetrics = evaluateTransitionPredictor(laterCases, transitions, topK);

    const reliabilityDelta = (
        earlierMetrics.sampleSize > 0
        && laterMetrics.sampleSize > 0
    )
        ? roundTo(Math.abs(earlierMetrics.reliabilityScore - laterMetrics.reliabilityScore))
        : null;

    return {
        earlierSampleSize: earlierMetrics.sampleSize,
        laterSampleSize: laterMetrics.sampleSize,
        earlierReliabilityScore: earlierMetrics.reliabilityScore,
        laterReliabilityScore: laterMetrics.reliabilityScore,
        reliabilityDelta,
    };
}

function buildReliabilityGate(
    sampleSize: number,
    reliabilityScore: number,
    adjacentWindow: AdjacentWindowMetrics,
    minimumSampleSize: number,
    minimumReliabilityScore: number,
    maximumAdjacentWindowReliabilityDelta: number
): ReliabilityGate {
    const reasons: string[] = [];

    if (sampleSize < minimumSampleSize) {
        reasons.push(`Sample size ${sampleSize} is below minimum ${minimumSampleSize}.`);
    }

    if (reliabilityScore < minimumReliabilityScore) {
        reasons.push(
            `Reliability score ${roundTo(reliabilityScore)} is below minimum ${minimumReliabilityScore}.`
        );
    }

    if (
        adjacentWindow.reliabilityDelta !== null
        && adjacentWindow.reliabilityDelta > maximumAdjacentWindowReliabilityDelta
    ) {
        reasons.push(
            `Adjacent window reliability delta ${adjacentWindow.reliabilityDelta} exceeds max ${maximumAdjacentWindowReliabilityDelta}.`
        );
    }

    return {
        status: reasons.length === 0 ? 'pass' : 'degraded',
        reasons,
        minimumSampleSize,
        minimumReliabilityScore,
        maximumAdjacentWindowReliabilityDelta,
    };
}

function medianTimestamp(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
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

    const testSplitTimestampMs = medianTimestamp(
        testSnapshots.map((snapshot: { capturedAt: Date }) => snapshot.capturedAt.getTime())
    );
    const testCases = snapshotsToEvaluationCases(
        testSnapshots.map((snapshot: {
            userId: string;
            capturedAt: Date;
            feedItems: Array<{
                videoId: string;
                engagementMetrics: Buffer | null;
            }>;
        }) => ({
            userId: snapshot.userId,
            capturedAt: snapshot.capturedAt,
            feedItems: snapshot.feedItems.map((item) => ({
                videoId: item.videoId,
                engagementMetrics: item.engagementMetrics,
            })),
        })),
        userCohorts,
        platform,
        boundedTopK,
        testSplitTimestampMs
    );

    const globalTransitions = normalizeTransitions(trainModel.globalTransitions);
    const globalMetrics = evaluateTransitionPredictor(testCases, globalTransitions, boundedTopK);
    const globalAdjacentWindow = deriveAdjacentWindowMetrics(
        testCases,
        globalTransitions,
        boundedTopK
    );
    const globalGate = buildReliabilityGate(
        globalMetrics.sampleSize,
        globalMetrics.reliabilityScore,
        globalAdjacentWindow,
        FORECAST_RELIABILITY_THRESHOLDS.globalMinimumSampleSize,
        FORECAST_RELIABILITY_THRESHOLDS.globalMinimumReliabilityScore,
        FORECAST_RELIABILITY_THRESHOLDS.maximumAdjacentWindowReliabilityDelta
    );

    const cohortMetrics: CohortEvaluationMetrics[] = [];
    for (const cohort of trainModel.cohorts.values()) {
        const cohortCases = testCases.filter((evaluationCase) => evaluationCase.cohortId === cohort.cohortId);
        if (cohortCases.length === 0) continue;

        const cohortTransitions = normalizeTransitions(cohort.transitionCounts);
        const metrics = evaluateTransitionPredictor(cohortCases, cohortTransitions, boundedTopK);
        const adjacentWindow = deriveAdjacentWindowMetrics(
            cohortCases,
            cohortTransitions,
            boundedTopK
        );
        cohortMetrics.push({
            cohortId: cohort.cohortId,
            users: cohort.users.length,
            ...metrics,
            adjacentWindow,
        });
    }

    cohortMetrics.sort((a, b) => b.reliabilityScore - a.reliabilityScore || b.sampleSize - a.sampleSize);
    const keyCohorts = cohortMetrics
        .slice()
        .sort((a, b) => b.users - a.users || b.sampleSize - a.sampleSize)
        .slice(0, FORECAST_RELIABILITY_THRESHOLDS.keyCohortCount)
        .map((cohort) => {
            const gate = buildReliabilityGate(
                cohort.sampleSize,
                cohort.reliabilityScore,
                cohort.adjacentWindow,
                FORECAST_RELIABILITY_THRESHOLDS.keyCohortMinimumSampleSize,
                FORECAST_RELIABILITY_THRESHOLDS.keyCohortMinimumReliabilityScore,
                FORECAST_RELIABILITY_THRESHOLDS.maximumAdjacentWindowReliabilityDelta
            );
            return {
                cohortId: cohort.cohortId,
                users: cohort.users,
                sampleSize: cohort.sampleSize,
                reliabilityScore: cohort.reliabilityScore,
                adjacentWindow: cohort.adjacentWindow,
                gate,
            };
        });
    const degradedKeyCohorts = keyCohorts.filter((cohort) => cohort.gate.status === 'degraded');
    const missingKeyCohortEvidence = keyCohorts.length === 0;
    const keyCohortGate: ReliabilityGate = {
        status: (!missingKeyCohortEvidence && degradedKeyCohorts.length === 0) ? 'pass' : 'degraded',
        reasons: missingKeyCohortEvidence
            ? ['No key cohort holdout evidence was available in the test split.']
            : degradedKeyCohorts.length === 0
                ? []
                : degradedKeyCohorts.map(
                    (cohort) => `Cohort ${cohort.cohortId} failed reliability gate.`
                ),
        minimumSampleSize: FORECAST_RELIABILITY_THRESHOLDS.keyCohortMinimumSampleSize,
        minimumReliabilityScore: FORECAST_RELIABILITY_THRESHOLDS.keyCohortMinimumReliabilityScore,
        maximumAdjacentWindowReliabilityDelta: FORECAST_RELIABILITY_THRESHOLDS.maximumAdjacentWindowReliabilityDelta,
    };

    return {
        platform,
        split: {
            trainSnapshots: trainSnapshots.length,
            testSnapshots: testSnapshots.length,
            trainItems: trainItems.length,
            testCases: testCases.length,
        },
        metrics: globalMetrics,
        adjacentWindow: globalAdjacentWindow,
        cohortMetrics,
        validation: {
            globalGate,
            keyCohortGate,
            keyCohorts,
        },
        generatedAt: new Date().toISOString(),
    };
}
