import {
    extractRecommendationsFromMetrics,
    extractRecommendationsWithDiagnostics,
    normalizeRecommendationVideoId,
} from './recommendationParsing.js';
import { decodeSessionMetadataResult } from './sessionMetadata.js';

let prismaClientPromise: Promise<any> | null = null;

async function getPrismaClient() {
    if (!prismaClientPromise) {
        prismaClientPromise = import('../lib/prisma.js').then((module) => module.prisma);
    }
    return prismaClientPromise;
}

export interface RawAudienceFeedItem {
    userId: string;
    videoId: string;
    creatorHandle: string | null;
    contentCategories: string[];
    engagementMetrics: Buffer | null;
    sessionId?: string;
    capturedAt?: Date;
}

interface ProfileAccumulator {
    userId: string;
    totalItems: number;
    creatorCounts: Map<string, number>;
    categoryCounts: Map<string, number>;
    seenVideos: Set<string>;
    transitionCounts: Map<string, Map<string, number>>;
    sessionSeenVideos: Map<string, Set<string>>;
    sessionEdgeCounts: Map<string, Map<string, number>>;
}

type DiversityBand = 'low' | 'medium' | 'high';
type LoyaltyBand = 'low' | 'medium' | 'high';

export interface UserProfile {
    userId: string;
    totalItems: number;
    dominantCategory: string;
    diversityBand: DiversityBand;
    loyaltyBand: LoyaltyBand;
    seenVideos: Set<string>;
    transitionCounts: Map<string, Map<string, number>>;
    cohortId: string;
}

export interface CohortAggregate {
    cohortId: string;
    users: string[];
    dominantCategory: string;
    diversityBand: DiversityBand;
    loyaltyBand: LoyaltyBand;
    transitionCounts: Map<string, Map<string, number>>;
}

export interface AudienceModel {
    userProfiles: Map<string, UserProfile>;
    cohorts: Map<string, CohortAggregate>;
    globalTransitions: Map<string, Map<string, number>>;
    totalFeedItems: number;
    totalTransitions: number;
}

interface TransitionProbability {
    toVideoId: string;
    count: number;
    probability: number;
}

type TransitionProbabilityMap = Map<string, TransitionProbability[]>;

export interface AudienceForecastOptions {
    targetVideoId: string;
    seedVideoId?: string;
    platform: string;
    maxDepth: number;
    beamWidth: number;
}

export interface CohortAudienceForecast {
    cohortId: string;
    cohortLabel: string;
    users: number;
    fitScore: number;
    targetExposureRate: number;
    exposureConfidenceInterval: {
        low: number;
        high: number;
    };
    directProbabilityFromSeed: number | null;
    reachProbabilityFromSeed: number | null;
    relativeLiftVsGlobalExposure: number | null;
    liftInterpretation: CohortLiftInterpretation;
    score: number;
}

export interface CohortLiftInterpretation {
    isLiftInterpretable: boolean;
    gateReasons: string[];
    cohortTransitionSamples: number;
    exposureConfidenceIntervalWidth: number;
    adjacentWindowLiftDelta: number | null;
    adjacentWindowUsers: {
        earlier: number;
        later: number;
    } | null;
}

export interface CohortLiftStabilityEvidence {
    adjacentWindowLiftDelta: number | null;
    adjacentWindowUsers: {
        earlier: number;
        later: number;
    };
}

export interface CohortStabilityConstraints {
    minimumCohortUsersForLift: number;
    minimumCohortTransitionSamplesForLift: number;
    maximumExposureConfidenceIntervalWidthForLift: number;
    minimumAdjacentWindowUsersForLiftStability: number;
    maximumAdjacentWindowLiftDelta: number;
}

export interface AudienceForecastResult {
    platform: string;
    targetVideoId: string;
    seedVideoId: string | null;
    settings: {
        maxDepth: number;
        beamWidth: number;
    };
    networkEffect: {
        comparedUsers: number;
        comparedFeedItems: number;
        comparedTransitions: number;
        pairwiseComparisons: number;
        cohortCount: number;
        networkStrength: number;
    };
    global: {
        targetExposureRate: number;
        targetExposureConfidenceInterval: {
            low: number;
            high: number;
        };
        directProbabilityFromSeed: number | null;
        reachProbabilityFromSeed: number | null;
    };
    stabilityConstraints: CohortStabilityConstraints;
    qualityGate: RecommendationQualityGate;
    recommendedAudienceCohorts: CohortAudienceForecast[];
    cohorts: CohortAudienceForecast[];
}

export interface RecommendationQualityGate {
    status: 'ok' | 'degraded';
    parseCoverage: number;
    parserDropRate: number;
    rawRecommendationRows: number;
    minimumParseCoverage: number;
    maxParserDropRate: number;
    strictRecommendationRows: number;
    duplicateRecommendationRows: number;
    dedupeImpactRate: number;
    minimumStrictRecommendationRows: number;
    comparedUsers: number;
    minimumComparedUsers: number;
    cohortStabilityScore: number;
    minimumCohortStabilityScore: number;
    metadataIntegrityScore: number;
    minimumMetadataIntegrityScore: number;
    snapshotsWithMetadata: number;
    decodedMetadataSnapshots: number;
    invalidMetadataSnapshots: number;
    minimumCohortUsersForLift: number;
    canInterpretLift: boolean;
    reasonCodes: RecommendationQualityReasonCode[];
    degradationReasons: string[];
    confidenceMultiplier: number;
}

export type RecommendationQualityReasonCode =
    | 'parse_coverage_below_minimum'
    | 'parser_drop_above_maximum'
    | 'strict_rows_below_minimum'
    | 'compared_users_below_minimum'
    | 'cohort_stability_below_minimum'
    | 'metadata_integrity_below_minimum'
    | 'forecast_reliability_unavailable'
    | 'forecast_reliability_low';

export interface RecommendationQualityThresholds {
    minimumParseCoverage: number;
    maxParserDropRate: number;
    minimumStrictRecommendationRows: number;
    minimumComparedUsers: number;
    minimumCohortStabilityScore: number;
    minimumMetadataIntegrityScore: number;
    minimumCohortUsersForLift: number;
}

export interface RecommendationQualityGateContext {
    minimumParseCoverage?: number;
    maxParserDropRate?: number;
    minimumStrictRecommendationRows?: number;
    minimumComparedUsers?: number;
    minimumCohortStabilityScore?: number;
    minimumMetadataIntegrityScore?: number;
    minimumCohortUsersForLift?: number;
    comparedUsers?: number;
    cohortStabilityScore?: number;
    metadataIntegrityScore?: number;
    snapshotsWithMetadata?: number;
    decodedMetadataSnapshots?: number;
    invalidMetadataSnapshots?: number;
}

const DEFAULT_RECOMMENDATION_QUALITY_THRESHOLDS: RecommendationQualityThresholds = {
    minimumParseCoverage: 0.2,
    maxParserDropRate: 0.8,
    minimumStrictRecommendationRows: 6,
    minimumComparedUsers: 3,
    minimumCohortStabilityScore: 0.55,
    minimumMetadataIntegrityScore: 0.8,
    minimumCohortUsersForLift: 3,
};

const PLATFORM_RECOMMENDATION_QUALITY_THRESHOLDS: Record<string, Partial<RecommendationQualityThresholds>> = {
    youtube: {
        minimumParseCoverage: 0.24,
        maxParserDropRate: 0.76,
        minimumStrictRecommendationRows: 8,
        minimumComparedUsers: 4,
        minimumCohortStabilityScore: 0.62,
        minimumMetadataIntegrityScore: 0.85,
        minimumCohortUsersForLift: 3,
    },
    instagram: {
        minimumParseCoverage: 0.2,
        maxParserDropRate: 0.8,
        minimumStrictRecommendationRows: 6,
        minimumComparedUsers: 3,
        minimumCohortStabilityScore: 0.58,
        minimumMetadataIntegrityScore: 0.8,
        minimumCohortUsersForLift: 3,
    },
    tiktok: {
        minimumParseCoverage: 0.2,
        maxParserDropRate: 0.8,
        minimumStrictRecommendationRows: 6,
        minimumComparedUsers: 3,
        minimumCohortStabilityScore: 0.58,
        minimumMetadataIntegrityScore: 0.8,
        minimumCohortUsersForLift: 3,
    },
};

export class AudienceForecastInputError extends Error {
    statusCode: number;
    details?: Record<string, unknown>;

    constructor(message: string, statusCode = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'AudienceForecastInputError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

const DEFAULT_COHORT_STABILITY_CONSTRAINTS: CohortStabilityConstraints = {
    minimumCohortUsersForLift: 3,
    minimumCohortTransitionSamplesForLift: 6,
    maximumExposureConfidenceIntervalWidthForLift: 0.9,
    minimumAdjacentWindowUsersForLiftStability: 2,
    maximumAdjacentWindowLiftDelta: 0.55,
};

function sanitizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function incrementCounter(counter: Map<string, number>, key: string, amount = 1) {
    counter.set(key, (counter.get(key) ?? 0) + amount);
}

function incrementNestedCounter(
    counter: Map<string, Map<string, number>>,
    source: string,
    target: string,
    amount = 1
) {
    let inner = counter.get(source);
    if (!inner) {
        inner = new Map<string, number>();
        counter.set(source, inner);
    }

    inner.set(target, (inner.get(target) ?? 0) + amount);
}

function dominantKey(counter: Map<string, number>, fallback: string): string {
    let bestKey = fallback;
    let bestCount = -1;

    for (const [key, count] of counter.entries()) {
        if (count > bestCount) {
            bestKey = key;
            bestCount = count;
        }
    }

    return bestKey;
}

function assignDiversityBand(totalItems: number, uniqueCreators: number): DiversityBand {
    if (totalItems <= 0) return 'low';
    const smoothedRatio = (uniqueCreators + 3) / (totalItems + 10);
    if (totalItems < 12) {
        if (smoothedRatio >= 0.48) return 'high';
        if (smoothedRatio >= 0.3) return 'medium';
        return 'low';
    }
    if (smoothedRatio >= 0.55) return 'high';
    if (smoothedRatio >= 0.32) return 'medium';
    return 'low';
}

function assignLoyaltyBand(topCreatorShare: number, totalItems: number): LoyaltyBand {
    const smoothedShare = (topCreatorShare * totalItems + 2) / (totalItems + 10);
    if (totalItems < 12) {
        if (smoothedShare >= 0.28) return 'high';
        if (smoothedShare >= 0.18) return 'medium';
        return 'low';
    }
    if (smoothedShare >= 0.33) return 'high';
    if (smoothedShare >= 0.2) return 'medium';
    return 'low';
}

function buildInitialCohortId(
    dominantCategory: string,
    diversityBand: DiversityBand,
    loyaltyBand: LoyaltyBand
) {
    return `${dominantCategory}|${diversityBand}|${loyaltyBand}`;
}

function cohortLabel(cohortId: string) {
    const [category, diversity, loyalty] = cohortId.split('|');
    return `${category} / ${diversity} discovery / ${loyalty} loyalty`;
}

function wilsonInterval(successes: number, trials: number, z = 1.96) {
    if (trials <= 0) return { low: 0, high: 0 };
    const p = successes / trials;
    const z2 = z * z;
    const denominator = 1 + z2 / trials;
    const center = p + z2 / (2 * trials);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials);

    return {
        low: roundTo((center - margin) / denominator),
        high: roundTo((center + margin) / denominator),
    };
}

function normalizeTransitions(
    transitionCounts: Map<string, Map<string, number>>
): TransitionProbabilityMap {
    const normalized = new Map<string, TransitionProbability[]>();

    for (const [source, targets] of transitionCounts.entries()) {
        let total = 0;
        for (const count of targets.values()) {
            total += count;
        }

        if (total <= 0) continue;

        const probabilities: TransitionProbability[] = [];
        for (const [target, count] of targets.entries()) {
            probabilities.push({
                toVideoId: target,
                count,
                probability: count / total,
            });
        }

        probabilities.sort((a, b) => b.probability - a.probability || b.count - a.count);
        normalized.set(source, probabilities);
    }

    return normalized;
}

function directProbability(
    normalizedTransitions: TransitionProbabilityMap,
    seedVideoId: string,
    targetVideoId: string
) {
    const edges = normalizedTransitions.get(seedVideoId);
    if (!edges) return 0;
    const edge = edges.find((candidate) => candidate.toVideoId === targetVideoId);
    return edge ? roundTo(edge.probability) : 0;
}

export function computeReachProbability(
    normalizedTransitions: TransitionProbabilityMap,
    seedVideoId: string,
    targetVideoId: string,
    maxDepth: number,
    beamWidth: number
) {
    if (seedVideoId === targetVideoId) return 1;

    let frontier = new Map<string, number>([[seedVideoId, 1]]);
    let reachProbability = 0;

    for (let depth = 1; depth <= maxDepth; depth += 1) {
        const next = new Map<string, number>();

        for (const [videoId, probabilityMass] of frontier.entries()) {
            const outgoing = normalizedTransitions.get(videoId);
            if (!outgoing || outgoing.length === 0) continue;

            const capped = outgoing.slice(0, beamWidth);
            for (const edge of capped) {
                const contribution = probabilityMass * edge.probability;
                next.set(edge.toVideoId, (next.get(edge.toVideoId) ?? 0) + contribution);
            }
        }

        const hitProbability = next.get(targetVideoId) ?? 0;
        reachProbability += hitProbability * (1 - reachProbability);
        next.delete(targetVideoId);

        if (next.size === 0) break;

        const rankedNext = Array.from(next.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, beamWidth);

        frontier = new Map(rankedNext);
    }

    return clamp(roundTo(reachProbability), 0, 1);
}

function addTransitionCounts(
    destination: Map<string, Map<string, number>>,
    source: Map<string, Map<string, number>>
) {
    for (const [videoId, targets] of source.entries()) {
        for (const [targetVideoId, count] of targets.entries()) {
            incrementNestedCounter(destination, videoId, targetVideoId, count);
        }
    }
}

function deriveFitScore(currentUser: UserProfile | undefined, cohort: CohortAggregate) {
    if (!currentUser) return 0.5;

    let score = 0;
    if (currentUser.dominantCategory === cohort.dominantCategory) {
        score += 0.5;
    }
    if (currentUser.diversityBand === cohort.diversityBand) {
        score += 0.35;
    }
    if (currentUser.loyaltyBand === cohort.loyaltyBand) {
        score += 0.15;
    }

    return roundTo(score);
}

function deriveNetworkStrength(comparedUsers: number, comparedTransitions: number) {
    const userSignal = 1 - Math.exp(-comparedUsers / 40);
    const transitionSignal = 1 - Math.exp(-comparedTransitions / 4000);
    return roundTo(clamp(userSignal * 0.6 + transitionSignal * 0.4, 0, 1));
}

function countTransitionSamples(transitionCounts: Map<string, Map<string, number>>) {
    let total = 0;
    for (const targets of transitionCounts.values()) {
        for (const count of targets.values()) {
            total += count;
        }
    }
    return total;
}

function evaluateLiftInterpretation(
    cohortUsers: number,
    cohortTransitionSamples: number,
    exposureInterval: { low: number; high: number },
    constraints: CohortStabilityConstraints,
    stabilityEvidence: CohortLiftStabilityEvidence | undefined
): CohortLiftInterpretation {
    const gateReasons: string[] = [];
    const exposureConfidenceIntervalWidth = roundTo(
        clamp(exposureInterval.high - exposureInterval.low, 0, 1)
    );

    if (cohortUsers < constraints.minimumCohortUsersForLift) {
        gateReasons.push(
            `Needs at least ${constraints.minimumCohortUsersForLift} cohort users (found ${cohortUsers}).`
        );
    }

    if (cohortTransitionSamples < constraints.minimumCohortTransitionSamplesForLift) {
        gateReasons.push(
            `Needs at least ${constraints.minimumCohortTransitionSamplesForLift} transition samples (found ${roundTo(cohortTransitionSamples, 2)}).`
        );
    }

    if (exposureConfidenceIntervalWidth > constraints.maximumExposureConfidenceIntervalWidthForLift) {
        gateReasons.push(
            `Exposure confidence band is too wide (${roundTo(exposureConfidenceIntervalWidth, 3)} > ${constraints.maximumExposureConfidenceIntervalWidthForLift}).`
        );
    }

    const adjacentWindowDelta = stabilityEvidence?.adjacentWindowLiftDelta ?? null;
    const adjacentWindowUsers = stabilityEvidence?.adjacentWindowUsers ?? null;

    if (adjacentWindowUsers) {
        if (
            adjacentWindowUsers.earlier < constraints.minimumAdjacentWindowUsersForLiftStability
            || adjacentWindowUsers.later < constraints.minimumAdjacentWindowUsersForLiftStability
        ) {
            gateReasons.push(
                `Adjacent window evidence needs at least ${constraints.minimumAdjacentWindowUsersForLiftStability} users per window (found ${adjacentWindowUsers.earlier}/${adjacentWindowUsers.later}).`
            );
        }
    }

    if (
        adjacentWindowDelta !== null
        && adjacentWindowDelta > constraints.maximumAdjacentWindowLiftDelta
    ) {
        gateReasons.push(
            `Lift delta between adjacent windows is too high (${adjacentWindowDelta.toFixed(3)} > ${constraints.maximumAdjacentWindowLiftDelta}).`
        );
    }

    return {
        isLiftInterpretable: gateReasons.length === 0,
        gateReasons,
        cohortTransitionSamples: roundTo(cohortTransitionSamples, 2),
        exposureConfidenceIntervalWidth,
        adjacentWindowLiftDelta: adjacentWindowDelta,
        adjacentWindowUsers,
    };
}

interface WindowExposureSummary {
    users: Set<string>;
    targetUsers: Set<string>;
}

export interface AudienceMetadataIntegritySummary {
    totalSnapshots: number;
    snapshotsWithMetadata: number;
    decodedMetadataSnapshots: number;
    invalidMetadataSnapshots: number;
    metadataIntegrityScore: number;
}

interface LoadedAudienceFeedItems {
    items: RawAudienceFeedItem[];
    metadataIntegrity: AudienceMetadataIntegritySummary;
    loadStats: {
        snapshotCount: number;
        stitchedItemCount: number;
        durationMs: number;
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

export function deriveCohortLiftStabilityEvidence(
    items: RawAudienceFeedItem[],
    model: AudienceModel,
    targetVideoId: string,
    platform = 'youtube'
): Map<string, CohortLiftStabilityEvidence> {
    const targetRaw = sanitizeString(targetVideoId);
    const normalizedTargetVideoId = targetRaw
        ? normalizeRecommendationVideoId(targetRaw, platform) ?? targetRaw
        : null;
    if (!normalizedTargetVideoId) return new Map<string, CohortLiftStabilityEvidence>();

    const timestamps: number[] = [];
    for (const item of items) {
        if (!(item.capturedAt instanceof Date)) continue;
        const time = item.capturedAt.getTime();
        if (Number.isFinite(time)) timestamps.push(time);
    }

    const splitTimestamp = medianTimestamp(timestamps);
    if (splitTimestamp === null) {
        return new Map<string, CohortLiftStabilityEvidence>();
    }

    const globalWindows: Record<'earlier' | 'later', WindowExposureSummary> = {
        earlier: { users: new Set<string>(), targetUsers: new Set<string>() },
        later: { users: new Set<string>(), targetUsers: new Set<string>() },
    };

    const cohortWindows = new Map<string, Record<'earlier' | 'later', WindowExposureSummary>>();

    for (const item of items) {
        if (!(item.capturedAt instanceof Date)) continue;
        const capturedAtMs = item.capturedAt.getTime();
        if (!Number.isFinite(capturedAtMs)) continue;

        const userId = sanitizeString(item.userId);
        const rawVideoId = sanitizeString(item.videoId);
        const videoId = rawVideoId
            ? normalizeRecommendationVideoId(rawVideoId, platform) ?? rawVideoId
            : null;
        if (!userId || !videoId) continue;

        const profile = model.userProfiles.get(userId);
        if (!profile) continue;

        const windowKey: 'earlier' | 'later' = capturedAtMs <= splitTimestamp ? 'earlier' : 'later';
        globalWindows[windowKey].users.add(userId);
        if (videoId === normalizedTargetVideoId) {
            globalWindows[windowKey].targetUsers.add(userId);
        }

        let cohortWindow = cohortWindows.get(profile.cohortId);
        if (!cohortWindow) {
            cohortWindow = {
                earlier: { users: new Set<string>(), targetUsers: new Set<string>() },
                later: { users: new Set<string>(), targetUsers: new Set<string>() },
            };
            cohortWindows.set(profile.cohortId, cohortWindow);
        }

        cohortWindow[windowKey].users.add(userId);
        if (videoId === normalizedTargetVideoId) {
            cohortWindow[windowKey].targetUsers.add(userId);
        }
    }

    const globalExposureByWindow = {
        earlier: globalWindows.earlier.users.size > 0
            ? globalWindows.earlier.targetUsers.size / globalWindows.earlier.users.size
            : null,
        later: globalWindows.later.users.size > 0
            ? globalWindows.later.targetUsers.size / globalWindows.later.users.size
            : null,
    };

    const stabilityByCohort = new Map<string, CohortLiftStabilityEvidence>();
    for (const [cohortId, windows] of cohortWindows.entries()) {
        const earlierCohortUsers = windows.earlier.users.size;
        const laterCohortUsers = windows.later.users.size;
        const earlierGlobalExposure = globalExposureByWindow.earlier;
        const laterGlobalExposure = globalExposureByWindow.later;

        const earlierCohortExposure = earlierCohortUsers > 0
            ? windows.earlier.targetUsers.size / earlierCohortUsers
            : null;
        const laterCohortExposure = laterCohortUsers > 0
            ? windows.later.targetUsers.size / laterCohortUsers
            : null;

        const earlierLift = (
            earlierCohortExposure !== null
            && earlierGlobalExposure !== null
            && earlierGlobalExposure > 0
        )
            ? earlierCohortExposure / earlierGlobalExposure
            : null;
        const laterLift = (
            laterCohortExposure !== null
            && laterGlobalExposure !== null
            && laterGlobalExposure > 0
        )
            ? laterCohortExposure / laterGlobalExposure
            : null;

        const adjacentWindowLiftDelta = (
            earlierLift !== null
            && laterLift !== null
        )
            ? roundTo(Math.abs(earlierLift - laterLift))
            : null;

        stabilityByCohort.set(cohortId, {
            adjacentWindowLiftDelta,
            adjacentWindowUsers: {
                earlier: earlierCohortUsers,
                later: laterCohortUsers,
            },
        });
    }

    return stabilityByCohort;
}

export function getRecommendationQualityThresholds(platform: string): RecommendationQualityThresholds {
    const normalizedPlatform = sanitizeString(platform)?.toLowerCase() ?? '';
    const overrides = PLATFORM_RECOMMENDATION_QUALITY_THRESHOLDS[normalizedPlatform] ?? {};
    return {
        ...DEFAULT_RECOMMENDATION_QUALITY_THRESHOLDS,
        ...overrides,
    };
}

export function deriveCohortStabilityScore(
    model: AudienceModel,
    minimumCohortUsers: number
): number {
    const eligibleUsers = model.userProfiles.size;
    if (eligibleUsers <= 0) return 0;

    let smallCohortUsers = 0;
    for (const cohort of model.cohorts.values()) {
        if (cohort.users.length < minimumCohortUsers) {
            smallCohortUsers += cohort.users.length;
        }
    }

    const unstableShare = smallCohortUsers / eligibleUsers;
    return roundTo(1 - clamp(unstableShare, 0, 1));
}

export function buildAudienceModel(items: RawAudienceFeedItem[], platform = 'youtube'): AudienceModel {
    const MIN_PROFILE_ITEMS = 3;
    const MIN_COHORT_USERS = 3;
    const MAX_EDGE_REPEATS_PER_SESSION = 3;

    const profileAccumulators = new Map<string, ProfileAccumulator>();
    let totalTransitions = 0;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        const userId = sanitizeString(item.userId);
        if (!userId) continue;

        const rawVideoId = sanitizeString(item.videoId);
        if (!rawVideoId) continue;
        const videoId = normalizeRecommendationVideoId(rawVideoId, platform) ?? rawVideoId;

        const sessionId = sanitizeString(item.sessionId) || `${userId}:row-${itemIndex}`;
        let profile = profileAccumulators.get(userId);
        if (!profile) {
            profile = {
                userId,
                totalItems: 0,
                creatorCounts: new Map<string, number>(),
                categoryCounts: new Map<string, number>(),
                seenVideos: new Set<string>(),
                transitionCounts: new Map<string, Map<string, number>>(),
                sessionSeenVideos: new Map<string, Set<string>>(),
                sessionEdgeCounts: new Map<string, Map<string, number>>(),
            };
            profileAccumulators.set(userId, profile);
        }

        let seenVideosInSession = profile.sessionSeenVideos.get(sessionId);
        if (!seenVideosInSession) {
            seenVideosInSession = new Set<string>();
            profile.sessionSeenVideos.set(sessionId, seenVideosInSession);
        }

        const firstTimeInSession = !seenVideosInSession.has(videoId);
        if (firstTimeInSession) {
            seenVideosInSession.add(videoId);
            profile.totalItems += 1;

            const creatorHandle = sanitizeString(item.creatorHandle);
            if (creatorHandle) {
                incrementCounter(profile.creatorCounts, creatorHandle);
            }

            const categories = Array.isArray(item.contentCategories) ? item.contentCategories : [];
            if (categories.length === 0) {
                incrementCounter(profile.categoryCounts, 'general');
            } else {
                for (const category of categories) {
                    const normalized = sanitizeString(category) || 'general';
                    incrementCounter(profile.categoryCounts, normalized);
                }
            }
        }

        profile.seenVideos.add(videoId);
        const recommendations = extractRecommendationsFromMetrics(item.engagementMetrics, {
            platform,
            sourceVideoId: videoId,
            maxRecommendations: 25,
        });

        let sessionEdgeCounts = profile.sessionEdgeCounts.get(sessionId);
        if (!sessionEdgeCounts) {
            sessionEdgeCounts = new Map<string, number>();
            profile.sessionEdgeCounts.set(sessionId, sessionEdgeCounts);
        }

        for (const recommendation of recommendations) {
            const edgeKey = `${videoId}->${recommendation.videoId}`;
            const previousCount = sessionEdgeCounts.get(edgeKey) ?? 0;
            if (previousCount >= MAX_EDGE_REPEATS_PER_SESSION) {
                continue;
            }

            const weight = 1 / (1 + previousCount);
            profile.seenVideos.add(recommendation.videoId);
            incrementNestedCounter(profile.transitionCounts, videoId, recommendation.videoId, weight);
            sessionEdgeCounts.set(edgeKey, previousCount + 1);
            totalTransitions += weight;
        }
    }

    const rawCohortCounts = new Map<string, number>();
    const provisionalProfiles = new Map<string, {
        userId: string;
        totalItems: number;
        dominantCategory: string;
        diversityBand: DiversityBand;
        loyaltyBand: LoyaltyBand;
        seenVideos: Set<string>;
        transitionCounts: Map<string, Map<string, number>>;
        rawCohortId: string;
    }>();

    for (const [userId, profile] of profileAccumulators.entries()) {
        if (profile.totalItems < MIN_PROFILE_ITEMS) continue;

        const dominantCategory = dominantKey(profile.categoryCounts, 'general');
        const dominantCategoryCount = profile.categoryCounts.get(dominantCategory) ?? 0;
        const dominantCategoryShare = profile.totalItems > 0
            ? dominantCategoryCount / profile.totalItems
            : 0;
        const stableCategory = dominantCategoryShare < 0.24 ? 'mixed' : dominantCategory;
        const uniqueCreators = profile.creatorCounts.size;
        const diversityBand = assignDiversityBand(profile.totalItems, uniqueCreators);
        const topCreatorCount = Array.from(profile.creatorCounts.values()).reduce(
            (maxCount, count) => Math.max(maxCount, count),
            0
        );
        const topCreatorShare = profile.totalItems > 0 ? topCreatorCount / profile.totalItems : 0;
        const loyaltyBand = assignLoyaltyBand(topCreatorShare, profile.totalItems);
        const rawCohortId = buildInitialCohortId(stableCategory, diversityBand, loyaltyBand);
        rawCohortCounts.set(rawCohortId, (rawCohortCounts.get(rawCohortId) ?? 0) + 1);

        provisionalProfiles.set(userId, {
            userId,
            totalItems: profile.totalItems,
            dominantCategory: stableCategory,
            diversityBand,
            loyaltyBand,
            seenVideos: profile.seenVideos,
            transitionCounts: profile.transitionCounts,
            rawCohortId,
        });
    }

    const userProfiles = new Map<string, UserProfile>();
    const cohorts = new Map<string, CohortAggregate>();
    const globalTransitions = new Map<string, Map<string, number>>();

    for (const [userId, profile] of provisionalProfiles.entries()) {
        const fallbackCohortId = `mixed|${profile.diversityBand}|${profile.loyaltyBand}`;
        const cohortId = (rawCohortCounts.get(profile.rawCohortId) ?? 0) >= MIN_COHORT_USERS
            ? profile.rawCohortId
            : fallbackCohortId;

        const userProfile: UserProfile = {
            userId,
            totalItems: profile.totalItems,
            dominantCategory: profile.dominantCategory,
            diversityBand: profile.diversityBand,
            loyaltyBand: profile.loyaltyBand,
            seenVideos: profile.seenVideos,
            transitionCounts: profile.transitionCounts,
            cohortId,
        };

        userProfiles.set(userId, userProfile);
        addTransitionCounts(globalTransitions, profile.transitionCounts);

        let cohort = cohorts.get(cohortId);
        if (!cohort) {
            const [category, diversity, loyalty] = cohortId.split('|');
            cohort = {
                cohortId,
                users: [],
                dominantCategory: category || 'general',
                diversityBand: (diversity as DiversityBand) || 'low',
                loyaltyBand: (loyalty as LoyaltyBand) || 'low',
                transitionCounts: new Map<string, Map<string, number>>(),
            };
            cohorts.set(cohortId, cohort);
        }

        cohort.users.push(userId);
        addTransitionCounts(cohort.transitionCounts, profile.transitionCounts);
    }

    return {
        userProfiles,
        cohorts,
        globalTransitions,
        totalFeedItems: items.length,
        totalTransitions,
    };
}

function defaultQualityGate(): RecommendationQualityGate {
    const thresholds = getRecommendationQualityThresholds('youtube');
    return {
        status: 'ok',
        parseCoverage: 1,
        parserDropRate: 0,
        rawRecommendationRows: thresholds.minimumStrictRecommendationRows,
        minimumParseCoverage: thresholds.minimumParseCoverage,
        maxParserDropRate: thresholds.maxParserDropRate,
        strictRecommendationRows: thresholds.minimumStrictRecommendationRows,
        duplicateRecommendationRows: 0,
        dedupeImpactRate: 0,
        minimumStrictRecommendationRows: thresholds.minimumStrictRecommendationRows,
        comparedUsers: thresholds.minimumComparedUsers,
        minimumComparedUsers: thresholds.minimumComparedUsers,
        cohortStabilityScore: 1,
        minimumCohortStabilityScore: thresholds.minimumCohortStabilityScore,
        metadataIntegrityScore: 1,
        minimumMetadataIntegrityScore: thresholds.minimumMetadataIntegrityScore,
        snapshotsWithMetadata: 0,
        decodedMetadataSnapshots: 0,
        invalidMetadataSnapshots: 0,
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
        canInterpretLift: true,
        reasonCodes: [],
        degradationReasons: [],
        confidenceMultiplier: 1,
    };
}

function scaleProbability(value: number | null, multiplier: number): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    return roundTo(clamp(value * multiplier, 0, 1));
}

function widenInterval(
    interval: { low: number; high: number },
    confidenceMultiplier: number
): { low: number; high: number } {
    if (confidenceMultiplier >= 0.999) return interval;

    const center = (interval.low + interval.high) / 2;
    const halfWidth = (interval.high - interval.low) / 2;
    const expansionFactor = 1 + ((1 - confidenceMultiplier) * 1.15);
    const widenedHalfWidth = clamp(halfWidth * expansionFactor + ((1 - confidenceMultiplier) * 0.02), 0, 0.5);

    return {
        low: roundTo(clamp(center - widenedHalfWidth, 0, 1)),
        high: roundTo(clamp(center + widenedHalfWidth, 0, 1)),
    };
}

function qualityReasonText(
    code: RecommendationQualityReasonCode,
    values: {
        parseCoverage: number;
        parserDropRate: number;
        strictRecommendationRows: number;
        comparedUsers: number;
        cohortStabilityScore: number;
        metadataIntegrityScore: number;
        invalidMetadataSnapshots: number;
        snapshotsWithMetadata: number;
    },
    thresholds: RecommendationQualityThresholds
) {
    switch (code) {
    case 'parse_coverage_below_minimum':
        return `Parse coverage ${roundTo(values.parseCoverage)} is below minimum ${roundTo(thresholds.minimumParseCoverage)}.`;
    case 'parser_drop_above_maximum':
        return `Parser drop rate ${roundTo(values.parserDropRate)} exceeds max ${roundTo(thresholds.maxParserDropRate)}.`;
    case 'strict_rows_below_minimum':
        return `Strict recommendation rows ${values.strictRecommendationRows} are below minimum ${thresholds.minimumStrictRecommendationRows}.`;
    case 'compared_users_below_minimum':
        return `Compared users ${values.comparedUsers} are below minimum ${thresholds.minimumComparedUsers}.`;
    case 'cohort_stability_below_minimum':
        return `Cohort stability ${roundTo(values.cohortStabilityScore)} is below minimum ${roundTo(thresholds.minimumCohortStabilityScore)}.`;
    case 'metadata_integrity_below_minimum':
        return values.snapshotsWithMetadata > 0
            ? `Metadata integrity ${roundTo(values.metadataIntegrityScore)} is below minimum ${roundTo(thresholds.minimumMetadataIntegrityScore)} because ${values.invalidMetadataSnapshots} snapshot(s) could not be decoded.`
            : 'Session metadata coverage is too sparse to verify stitching integrity for this forecast window.';
    case 'forecast_reliability_low':
        return 'Forecast reliability is below the minimum confidence threshold.';
    case 'forecast_reliability_unavailable':
        return 'Forecast reliability could not be evaluated for this window.';
    default:
        return 'Quality signal degraded.';
    }
}

export function deriveRecommendationQualityGate(
    items: RawAudienceFeedItem[],
    platform: string,
    contextOrMinimumParseCoverage: RecommendationQualityGateContext | number = {}
): RecommendationQualityGate {
    const context: RecommendationQualityGateContext = typeof contextOrMinimumParseCoverage === 'number'
        ? { minimumParseCoverage: contextOrMinimumParseCoverage }
        : contextOrMinimumParseCoverage;
    const platformThresholds = getRecommendationQualityThresholds(platform);
    const thresholds: RecommendationQualityThresholds = {
        minimumParseCoverage: clamp(
            context.minimumParseCoverage ?? platformThresholds.minimumParseCoverage,
            0,
            1
        ),
        maxParserDropRate: clamp(
            context.maxParserDropRate ?? platformThresholds.maxParserDropRate,
            0,
            1
        ),
        minimumStrictRecommendationRows: Math.max(
            0,
            Math.round(context.minimumStrictRecommendationRows ?? platformThresholds.minimumStrictRecommendationRows)
        ),
        minimumComparedUsers: Math.max(
            1,
            Math.round(context.minimumComparedUsers ?? platformThresholds.minimumComparedUsers)
        ),
        minimumCohortStabilityScore: clamp(
            context.minimumCohortStabilityScore ?? platformThresholds.minimumCohortStabilityScore,
            0,
            1
        ),
        minimumMetadataIntegrityScore: clamp(
            context.minimumMetadataIntegrityScore ?? platformThresholds.minimumMetadataIntegrityScore,
            0,
            1
        ),
        minimumCohortUsersForLift: Math.max(
            2,
            Math.round(context.minimumCohortUsersForLift ?? platformThresholds.minimumCohortUsersForLift)
        ),
    };

    let rawRecommendationRows = 0;
    let strictRecommendationRows = 0;
    let duplicateRecommendationRows = 0;
    const comparedUserIds = new Set<string>();

    for (const item of items) {
        const userId = sanitizeString(item.userId);
        if (userId) comparedUserIds.add(userId);

        if (!item.engagementMetrics) continue;

        const parsed = extractRecommendationsWithDiagnostics(item.engagementMetrics, {
            platform,
            sourceVideoId: item.videoId,
            maxRecommendations: 40,
        });
        rawRecommendationRows += parsed.diagnostics.rawRecommendationRows;
        strictRecommendationRows += parsed.diagnostics.strictRecommendationRows;
        duplicateRecommendationRows += parsed.diagnostics.duplicateRecommendationRows;
    }

    const parseCoverage = rawRecommendationRows > 0
        ? strictRecommendationRows / rawRecommendationRows
        : 0;
    const parserDropRate = rawRecommendationRows > 0
        ? 1 - parseCoverage
        : 0;
    const dedupeImpactRate = rawRecommendationRows > 0
        ? duplicateRecommendationRows / rawRecommendationRows
        : 0;
    const comparedUsers = Math.max(
        0,
        Math.round(context.comparedUsers ?? comparedUserIds.size)
    );
    const cohortStabilityScore = clamp(
        Number.isFinite(context.cohortStabilityScore)
            ? Number(context.cohortStabilityScore)
            : 1,
        0,
        1
    );
    const metadataIntegrityScore = clamp(
        Number.isFinite(context.metadataIntegrityScore)
            ? Number(context.metadataIntegrityScore)
            : 1,
        0,
        1
    );
    const snapshotsWithMetadata = Math.max(
        0,
        Math.round(context.snapshotsWithMetadata ?? 0)
    );
    const decodedMetadataSnapshots = Math.max(
        0,
        Math.round(context.decodedMetadataSnapshots ?? snapshotsWithMetadata)
    );
    const invalidMetadataSnapshots = Math.max(
        0,
        Math.round(context.invalidMetadataSnapshots ?? Math.max(0, snapshotsWithMetadata - decodedMetadataSnapshots))
    );

    const reasonCodes: RecommendationQualityReasonCode[] = [];
    if (parseCoverage < thresholds.minimumParseCoverage) {
        reasonCodes.push('parse_coverage_below_minimum');
    }
    if (parserDropRate > thresholds.maxParserDropRate) {
        reasonCodes.push('parser_drop_above_maximum');
    }
    if (strictRecommendationRows < thresholds.minimumStrictRecommendationRows) {
        reasonCodes.push('strict_rows_below_minimum');
    }
    if (comparedUsers < thresholds.minimumComparedUsers) {
        reasonCodes.push('compared_users_below_minimum');
    }
    if (cohortStabilityScore < thresholds.minimumCohortStabilityScore) {
        reasonCodes.push('cohort_stability_below_minimum');
    }
    if (metadataIntegrityScore < thresholds.minimumMetadataIntegrityScore) {
        reasonCodes.push('metadata_integrity_below_minimum');
    }

    const parsePenalty = parseCoverage < thresholds.minimumParseCoverage
        ? (1 - (parseCoverage / Math.max(thresholds.minimumParseCoverage, 0.001))) * 0.34
        : 0;
    const parserDropPenalty = parserDropRate > thresholds.maxParserDropRate
        ? ((parserDropRate - thresholds.maxParserDropRate) / Math.max(1 - thresholds.maxParserDropRate, 0.001)) * 0.2
        : 0;
    const strictRowsPenalty = strictRecommendationRows < thresholds.minimumStrictRecommendationRows
        ? (1 - (strictRecommendationRows / Math.max(thresholds.minimumStrictRecommendationRows, 1))) * 0.2
        : 0;
    const comparedUsersPenalty = comparedUsers < thresholds.minimumComparedUsers
        ? (1 - (comparedUsers / Math.max(thresholds.minimumComparedUsers, 1))) * 0.16
        : 0;
    const cohortStabilityPenalty = cohortStabilityScore < thresholds.minimumCohortStabilityScore
        ? (1 - (cohortStabilityScore / Math.max(thresholds.minimumCohortStabilityScore, 0.001))) * 0.1
        : 0;
    const metadataIntegrityPenalty = metadataIntegrityScore < thresholds.minimumMetadataIntegrityScore
        ? (1 - (metadataIntegrityScore / Math.max(thresholds.minimumMetadataIntegrityScore, 0.001))) * 0.12
        : 0;

    const confidencePenalty = parsePenalty
        + parserDropPenalty
        + strictRowsPenalty
        + comparedUsersPenalty
        + cohortStabilityPenalty
        + metadataIntegrityPenalty;
    const confidenceMultiplier = clamp(1 - confidencePenalty, 0.35, 1);
    const status: RecommendationQualityGate['status'] = reasonCodes.length > 0 ? 'degraded' : 'ok';
    const canInterpretLift = status === 'ok'
        && comparedUsers >= thresholds.minimumComparedUsers
        && cohortStabilityScore >= thresholds.minimumCohortStabilityScore;
    const degradationReasons = reasonCodes.map((reasonCode) => qualityReasonText(
        reasonCode,
        {
            parseCoverage,
            parserDropRate,
            strictRecommendationRows,
            comparedUsers,
            cohortStabilityScore,
            metadataIntegrityScore,
            invalidMetadataSnapshots,
            snapshotsWithMetadata,
        },
        thresholds
    ));

    return {
        status,
        parseCoverage: roundTo(clamp(parseCoverage, 0, 1)),
        parserDropRate: roundTo(clamp(parserDropRate, 0, 1)),
        rawRecommendationRows,
        minimumParseCoverage: roundTo(thresholds.minimumParseCoverage),
        maxParserDropRate: roundTo(thresholds.maxParserDropRate),
        strictRecommendationRows,
        duplicateRecommendationRows,
        dedupeImpactRate: roundTo(clamp(dedupeImpactRate, 0, 1)),
        minimumStrictRecommendationRows: thresholds.minimumStrictRecommendationRows,
        comparedUsers,
        minimumComparedUsers: thresholds.minimumComparedUsers,
        cohortStabilityScore: roundTo(cohortStabilityScore),
        minimumCohortStabilityScore: roundTo(thresholds.minimumCohortStabilityScore),
        metadataIntegrityScore: roundTo(metadataIntegrityScore),
        minimumMetadataIntegrityScore: roundTo(thresholds.minimumMetadataIntegrityScore),
        snapshotsWithMetadata,
        decodedMetadataSnapshots,
        invalidMetadataSnapshots,
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
        canInterpretLift,
        reasonCodes,
        degradationReasons,
        confidenceMultiplier: roundTo(confidenceMultiplier),
    };
}

export function computeAudienceForecastFromModel(
    model: AudienceModel,
    currentUserId: string,
    options: AudienceForecastOptions,
    qualityGate?: RecommendationQualityGate,
    liftStabilityByCohort?: Map<string, CohortLiftStabilityEvidence>
): AudienceForecastResult {
    const targetVideoId = options.targetVideoId.trim();
    if (!targetVideoId) {
        throw new AudienceForecastInputError('targetVideoId is required');
    }

    const seedVideoId = options.seedVideoId?.trim() || null;
    const maxDepth = clamp(options.maxDepth, 1, 6);
    const beamWidth = clamp(options.beamWidth, 5, 120);
    const resolvedQualityGate = qualityGate ?? defaultQualityGate();
    const confidenceMultiplier = clamp(resolvedQualityGate.confidenceMultiplier, 0.4, 1);
    const stabilityConstraints = DEFAULT_COHORT_STABILITY_CONSTRAINTS;
    const qualityLiftGateActive = resolvedQualityGate.canInterpretLift;

    const users = Array.from(model.userProfiles.values());
    if (users.length === 0) {
        throw new AudienceForecastInputError(
            `Not enough feed comparison data for ${options.platform}.`,
            404,
            { platform: options.platform }
        );
    }

    const globalNormalized = normalizeTransitions(model.globalTransitions);
    const globalTargetUsers = users.filter((user) => user.seenVideos.has(targetVideoId)).length;
    const globalExposureRate = globalTargetUsers / users.length;
    const globalExposureInterval = widenInterval(
        wilsonInterval(globalTargetUsers, users.length),
        confidenceMultiplier
    );

    const globalDirectProbability = seedVideoId
        ? scaleProbability(directProbability(globalNormalized, seedVideoId, targetVideoId), confidenceMultiplier)
        : null;
    const globalReachProbability = seedVideoId
        ? scaleProbability(
            computeReachProbability(globalNormalized, seedVideoId, targetVideoId, maxDepth, beamWidth),
            confidenceMultiplier
        )
        : null;

    const currentUser = model.userProfiles.get(currentUserId);
    const cohorts: CohortAudienceForecast[] = [];

    for (const cohort of model.cohorts.values()) {
        const cohortUsers = cohort.users
            .map((userId) => model.userProfiles.get(userId))
            .filter((user): user is UserProfile => Boolean(user));

        if (cohortUsers.length === 0) continue;

        const targetUsers = cohortUsers.filter((user) => user.seenVideos.has(targetVideoId)).length;
        const exposureRate = targetUsers / cohortUsers.length;
        const exposureInterval = widenInterval(
            wilsonInterval(targetUsers, cohortUsers.length),
            confidenceMultiplier
        );
        const cohortTransitionSamples = countTransitionSamples(cohort.transitionCounts);
        const liftInterpretation = evaluateLiftInterpretation(
            cohortUsers.length,
            cohortTransitionSamples,
            exposureInterval,
            stabilityConstraints,
            liftStabilityByCohort?.get(cohort.cohortId)
        );
        const qualityGateReasons = qualityLiftGateActive
            ? []
            : resolvedQualityGate.degradationReasons.map((reason) => `Quality gate: ${reason}`);
        const enforcedLiftInterpretation: CohortLiftInterpretation = qualityLiftGateActive
            ? liftInterpretation
            : {
                ...liftInterpretation,
                isLiftInterpretable: false,
                gateReasons: [...liftInterpretation.gateReasons, ...qualityGateReasons],
            };
        const fitScore = deriveFitScore(currentUser, cohort);

        const normalizedTransitions = normalizeTransitions(cohort.transitionCounts);
        const directFromSeed = seedVideoId
            ? scaleProbability(directProbability(normalizedTransitions, seedVideoId, targetVideoId), confidenceMultiplier)
            : null;
        const reachFromSeed = seedVideoId
            ? scaleProbability(
                computeReachProbability(normalizedTransitions, seedVideoId, targetVideoId, maxDepth, beamWidth),
                confidenceMultiplier
            )
            : null;

        const relativeLift = enforcedLiftInterpretation.isLiftInterpretable && globalExposureRate > 0
            ? roundTo(exposureRate / globalExposureRate)
            : null;

        const score = seedVideoId
            ? roundTo(((reachFromSeed ?? 0) * 0.58 + exposureRate * 0.27 + fitScore * 0.15) * confidenceMultiplier)
            : roundTo((exposureRate * 0.72 + fitScore * 0.28) * confidenceMultiplier);

        cohorts.push({
            cohortId: cohort.cohortId,
            cohortLabel: cohortLabel(cohort.cohortId),
            users: cohortUsers.length,
            fitScore,
            targetExposureRate: roundTo(exposureRate),
            exposureConfidenceInterval: exposureInterval,
            directProbabilityFromSeed: directFromSeed,
            reachProbabilityFromSeed: reachFromSeed,
            relativeLiftVsGlobalExposure: relativeLift,
            liftInterpretation: enforcedLiftInterpretation,
            score,
        });
    }

    cohorts.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.users !== a.users) return b.users - a.users;
        return a.cohortId.localeCompare(b.cohortId);
    });

    const minimumRecommendedCohortUsers = Math.max(2, resolvedQualityGate.minimumCohortUsersForLift);
    const interpretableCohorts = cohorts.filter(
        (cohort) => cohort.users >= minimumRecommendedCohortUsers && cohort.liftInterpretation.isLiftInterpretable
    );
    const fallbackCohorts = cohorts.filter((cohort) => cohort.users >= minimumRecommendedCohortUsers);
    const recommendedAudienceCohorts = (
        interpretableCohorts.length > 0 ? interpretableCohorts : fallbackCohorts
    ).slice(0, 5);

    return {
        platform: options.platform,
        targetVideoId,
        seedVideoId,
        settings: {
            maxDepth,
            beamWidth,
        },
        networkEffect: {
            comparedUsers: users.length,
            comparedFeedItems: model.totalFeedItems,
            comparedTransitions: model.totalTransitions,
            pairwiseComparisons: Math.max(0, Math.round((users.length * (users.length - 1)) / 2)),
            cohortCount: model.cohorts.size,
            networkStrength: roundTo(
                deriveNetworkStrength(users.length, model.totalTransitions) * confidenceMultiplier
            ),
        },
        global: {
            targetExposureRate: roundTo(globalExposureRate),
            targetExposureConfidenceInterval: globalExposureInterval,
            directProbabilityFromSeed: globalDirectProbability,
            reachProbabilityFromSeed: globalReachProbability,
        },
        stabilityConstraints,
        qualityGate: resolvedQualityGate,
        recommendedAudienceCohorts,
        cohorts,
    };
}

interface SnapshotFeedItem {
    videoId: string;
    creatorHandle: string | null;
    contentCategories: string[];
    engagementMetrics: Buffer | null;
    positionInFeed: number;
}

interface AudienceSnapshot {
    id: string;
    userId: string;
    capturedAt: Date;
    sessionMetadata: Buffer | null;
    feedItems: SnapshotFeedItem[];
}

const SESSION_GAP_MS = 25 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const SNAPSHOT_FINGERPRINT_LIMIT = 35;
const DUPLICATE_OVERLAP_THRESHOLD = 0.9;

function buildSnapshotFingerprint(items: SnapshotFeedItem[]) {
    const orderedIds = items
        .slice()
        .sort((a, b) => a.positionInFeed - b.positionInFeed)
        .map((item) => sanitizeString(item.videoId))
        .filter((videoId): videoId is string => Boolean(videoId))
        .slice(0, SNAPSHOT_FINGERPRINT_LIMIT);

    return {
        key: orderedIds.join('|'),
        ids: new Set(orderedIds),
    };
}

function overlapRatio(left: Set<string>, right: Set<string>) {
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    const smaller = left.size <= right.size ? left : right;
    const larger = left.size <= right.size ? right : left;
    for (const item of smaller) {
        if (larger.has(item)) intersection += 1;
    }

    return intersection / Math.max(left.size, right.size);
}

function stitchAndDedupeSnapshots(snapshots: AudienceSnapshot[]): RawAudienceFeedItem[] {
    const stitchedItems: RawAudienceFeedItem[] = [];
    const snapshotsByUser = new Map<string, AudienceSnapshot[]>();

    for (const snapshot of snapshots) {
        const userId = sanitizeString(snapshot.userId);
        if (!userId) continue;

        let userSnapshots = snapshotsByUser.get(userId);
        if (!userSnapshots) {
            userSnapshots = [];
            snapshotsByUser.set(userId, userSnapshots);
        }
        userSnapshots.push(snapshot);
    }

    for (const [userId, userSnapshots] of snapshotsByUser.entries()) {
        userSnapshots.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

        let nextSessionNumber = 0;
        let lastSessionId: string | null = null;
        const stitchedSessionKeyToSessionId = new Map<string, string>();
        let previousKept: {
            capturedAtMs: number;
            fingerprintKey: string;
            fingerprintIds: Set<string>;
            fingerprintHash: string | null;
        } | null = null;

        for (const snapshot of userSnapshots) {
            const metadataResult = decodeSessionMetadataResult(snapshot.sessionMetadata);
            const quality = asRecord(metadataResult.metadata?.quality);
            const stitchedSessionKey = sanitizeString(quality.stitchedSessionKey);
            const fingerprintHash = sanitizeString(quality.fingerprintHash);
            const capturedAtMs = snapshot.capturedAt.getTime();

            let sessionId: string;
            if (stitchedSessionKey) {
                const existingSessionId = stitchedSessionKeyToSessionId.get(stitchedSessionKey);
                if (existingSessionId) {
                    sessionId = existingSessionId;
                } else {
                    nextSessionNumber += 1;
                    sessionId = `${userId}:session-${nextSessionNumber}`;
                    stitchedSessionKeyToSessionId.set(stitchedSessionKey, sessionId);
                }
                lastSessionId = sessionId;
            } else {
                const isNewSession = !previousKept || (capturedAtMs - previousKept.capturedAtMs > SESSION_GAP_MS);
                if (isNewSession || !lastSessionId) {
                    nextSessionNumber += 1;
                    lastSessionId = `${userId}:session-${nextSessionNumber}`;
                }
                sessionId = lastSessionId;
            }

            const fingerprint = buildSnapshotFingerprint(snapshot.feedItems);
            const isDuplicate = previousKept
                ? (() => {
                    const gapMs = capturedAtMs - previousKept.capturedAtMs;
                    if (gapMs > DUPLICATE_WINDOW_MS) return false;
                    if (fingerprintHash && previousKept.fingerprintHash && fingerprintHash === previousKept.fingerprintHash) {
                        return true;
                    }
                    if (fingerprint.key === previousKept.fingerprintKey) return true;
                    return overlapRatio(fingerprint.ids, previousKept.fingerprintIds) >= DUPLICATE_OVERLAP_THRESHOLD;
                })()
                : false;

            if (isDuplicate) {
                continue;
            }

            previousKept = {
                capturedAtMs,
                fingerprintKey: fingerprint.key,
                fingerprintIds: fingerprint.ids,
                fingerprintHash,
            };

            for (const feedItem of snapshot.feedItems) {
                stitchedItems.push({
                    userId,
                    videoId: feedItem.videoId,
                    creatorHandle: feedItem.creatorHandle,
                    contentCategories: feedItem.contentCategories,
                    engagementMetrics: feedItem.engagementMetrics,
                    sessionId,
                    capturedAt: snapshot.capturedAt,
                });
            }
        }
    }

    return stitchedItems;
}

function summarizeAudienceMetadataIntegrity(snapshots: AudienceSnapshot[]): AudienceMetadataIntegritySummary {
    let snapshotsWithMetadata = 0;
    let decodedMetadataSnapshots = 0;
    let invalidMetadataSnapshots = 0;

    for (const snapshot of snapshots) {
        const decoded = decodeSessionMetadataResult(snapshot.sessionMetadata);
        if (decoded.status === 'missing') {
            continue;
        }

        snapshotsWithMetadata += 1;
        if (decoded.status === 'decoded') {
            decodedMetadataSnapshots += 1;
        } else {
            invalidMetadataSnapshots += 1;
        }
    }

    const metadataIntegrityScore = snapshotsWithMetadata > 0
        ? decodedMetadataSnapshots / snapshotsWithMetadata
        : 1;

    return {
        totalSnapshots: snapshots.length,
        snapshotsWithMetadata,
        decodedMetadataSnapshots,
        invalidMetadataSnapshots,
        metadataIntegrityScore: roundTo(clamp(metadataIntegrityScore, 0, 1)),
    };
}

async function loadAudienceFeedItemsDetailed(platform: string): Promise<LoadedAudienceFeedItems> {
    const startedAt = Date.now();
    const prisma = await getPrismaClient();
    const snapshots = await prisma.feedSnapshot.findMany({
        where: { platform },
        select: {
            id: true,
            userId: true,
            capturedAt: true,
            sessionMetadata: true,
            feedItems: {
                orderBy: {
                    positionInFeed: 'asc',
                },
                select: {
                    videoId: true,
                    creatorHandle: true,
                    contentCategories: true,
                    engagementMetrics: true,
                    positionInFeed: true,
                },
            },
        },
        take: 1200,
        orderBy: [
            { userId: 'asc' },
            { capturedAt: 'asc' },
        ],
    });

    if (snapshots.length === 0) {
        return {
            items: [],
            metadataIntegrity: summarizeAudienceMetadataIntegrity([]),
            loadStats: {
                snapshotCount: 0,
                stitchedItemCount: 0,
                durationMs: Date.now() - startedAt,
            },
        };
    }

    const items = stitchAndDedupeSnapshots(snapshots);

    return {
        items,
        metadataIntegrity: summarizeAudienceMetadataIntegrity(snapshots),
        loadStats: {
            snapshotCount: snapshots.length,
            stitchedItemCount: items.length,
            durationMs: Date.now() - startedAt,
        },
    };
}

export async function loadAudienceFeedItems(platform: string): Promise<RawAudienceFeedItem[]> {
    const { items } = await loadAudienceFeedItemsDetailed(platform);
    return items;
}

export async function getCohortUserIds(platform: string, cohortId: string): Promise<string[]> {
    const normalizedCohortId = cohortId.trim();
    if (!normalizedCohortId) {
        throw new AudienceForecastInputError('cohortId is required');
    }

    const { items } = await loadAudienceFeedItemsDetailed(platform);
    if (items.length === 0) {
        throw new AudienceForecastInputError(
            `No ${platform} comparison snapshots found yet.`,
            404,
            { platform }
        );
    }

    const model = buildAudienceModel(items, platform);
    const cohort = model.cohorts.get(normalizedCohortId);
    if (!cohort) {
        throw new AudienceForecastInputError(
            'Requested cohort was not found for this platform.',
            404,
            { cohortId: normalizedCohortId, platform }
        );
    }

    return cohort.users;
}

export async function generateAudienceForecast(
    currentUserId: string,
    options: AudienceForecastOptions
): Promise<AudienceForecastResult> {
    const loaded = await loadAudienceFeedItemsDetailed(options.platform);
    const { items, metadataIntegrity, loadStats } = loaded;
    if (items.length === 0) {
        throw new AudienceForecastInputError(
            `No ${options.platform} comparison snapshots found yet.`,
            404,
            { platform: options.platform }
        );
    }

    const model = buildAudienceModel(items, options.platform);
    const thresholds = getRecommendationQualityThresholds(options.platform);
    const cohortStabilityScore = deriveCohortStabilityScore(
        model,
        thresholds.minimumCohortUsersForLift
    );
    const qualityGate = deriveRecommendationQualityGate(items, options.platform, {
        comparedUsers: model.userProfiles.size,
        cohortStabilityScore,
        metadataIntegrityScore: metadataIntegrity.metadataIntegrityScore,
        snapshotsWithMetadata: metadataIntegrity.snapshotsWithMetadata,
        decodedMetadataSnapshots: metadataIntegrity.decodedMetadataSnapshots,
        invalidMetadataSnapshots: metadataIntegrity.invalidMetadataSnapshots,
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
    });
    const liftStabilityByCohort = deriveCohortLiftStabilityEvidence(
        items,
        model,
        options.targetVideoId,
        options.platform
    );
    console.info('analysis.audience-forecast.load', {
        platform: options.platform,
        snapshotCount: loadStats.snapshotCount,
        stitchedItemCount: loadStats.stitchedItemCount,
        metadataIntegrityScore: metadataIntegrity.metadataIntegrityScore,
        invalidMetadataSnapshots: metadataIntegrity.invalidMetadataSnapshots,
        durationMs: loadStats.durationMs,
    });
    return computeAudienceForecastFromModel(
        model,
        currentUserId,
        options,
        qualityGate,
        liftStabilityByCohort
    );
}
