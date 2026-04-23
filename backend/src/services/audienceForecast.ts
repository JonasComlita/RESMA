import {
    buildAudienceModel,
    cohortLabel,
    computeReachProbability,
    countTransitionSamples,
    deriveCohortLiftStabilityEvidence,
    deriveCohortStabilityScore,
    deriveFitScore,
    deriveNetworkStrength,
    directProbability,
    evaluateLiftInterpretation,
    normalizeTransitions,
    wilsonInterval,
} from './audienceForecastModel.js';
import {
    getRecommendationQualityThresholds,
    deriveRecommendationQualityGate,
} from './audienceForecastQuality.js';
import {
    loadAudienceFeedItems,
    loadAudienceFeedItemsDetailed,
    type LoadedAudienceFeedItems,
} from './audienceForecastLoader.js';
import { config } from '../config.js';

export interface RawAudienceFeedItem {
    userId: string;
    videoId: string;
    creatorHandle: string | null;
    contentCategories: string[];
    engagementMetrics: Buffer | null;
    sessionId?: string;
    capturedAt?: Date;
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

interface MaterializedAudienceModelContext {
    loaded: LoadedAudienceFeedItems;
    model: AudienceModel;
    qualityGate: RecommendationQualityGate;
}

const materializedAudienceModelCache = new Map<string, {
    expiresAt: number;
    cacheKey: string;
    value: MaterializedAudienceModelContext;
}>();
const liftStabilityCache = new Map<string, {
    expiresAt: number;
    cacheKey: string;
    value: Map<string, CohortLiftStabilityEvidence>;
}>();

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

export function resetAudienceForecastMaterializationForTests() {
    materializedAudienceModelCache.clear();
    liftStabilityCache.clear();
}

export async function loadMaterializedAudienceModelContext(
    platform: string
): Promise<MaterializedAudienceModelContext> {
    const loaded = await loadAudienceFeedItemsDetailed(platform);
    const cacheKey = loaded.loadStats.watermarkKey;
    const cached = materializedAudienceModelCache.get(platform);
    if (
        cached
        && cached.expiresAt > Date.now()
        && cached.cacheKey === cacheKey
    ) {
        return cached.value;
    }

    if (loaded.items.length === 0) {
        throw new AudienceForecastInputError(
            `No ${platform} comparison snapshots found yet.`,
            404,
            { platform }
        );
    }

    const model = buildAudienceModel(loaded.items, platform);
    const thresholds = getRecommendationQualityThresholds(platform);
    const cohortStabilityScore = deriveCohortStabilityScore(
        model,
        thresholds.minimumCohortUsersForLift
    );
    const qualityGate = deriveRecommendationQualityGate(loaded.items, platform, {
        comparedUsers: model.userProfiles.size,
        cohortStabilityScore,
        metadataIntegrityScore: loaded.metadataIntegrity.metadataIntegrityScore,
        snapshotsWithMetadata: loaded.metadataIntegrity.snapshotsWithMetadata,
        decodedMetadataSnapshots: loaded.metadataIntegrity.decodedMetadataSnapshots,
        invalidMetadataSnapshots: loaded.metadataIntegrity.invalidMetadataSnapshots,
        minimumCohortUsersForLift: thresholds.minimumCohortUsersForLift,
    });

    const value: MaterializedAudienceModelContext = {
        loaded,
        model,
        qualityGate,
    };

    materializedAudienceModelCache.set(platform, {
        expiresAt: Date.now() + config.analytics.materializedCacheTtlMs,
        cacheKey,
        value,
    });

    return value;
}

export async function loadCohortLiftStabilityEvidence(
    platform: string,
    targetVideoId: string
): Promise<Map<string, CohortLiftStabilityEvidence>> {
    const context = await loadMaterializedAudienceModelContext(platform);
    const cacheKey = `${context.loaded.loadStats.watermarkKey}:${targetVideoId}`;
    const cached = liftStabilityCache.get(platform);
    if (
        cached
        && cached.expiresAt > Date.now()
        && cached.cacheKey === cacheKey
    ) {
        return cached.value;
    }

    const value = deriveCohortLiftStabilityEvidence(
        context.loaded.items,
        context.model,
        targetVideoId,
        platform
    );

    liftStabilityCache.set(platform, {
        expiresAt: Date.now() + config.analytics.materializedCacheTtlMs,
        cacheKey,
        value,
    });

    return value;
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

export async function getCohortUserIds(platform: string, cohortId: string): Promise<string[]> {
    const normalizedCohortId = cohortId.trim();
    if (!normalizedCohortId) {
        throw new AudienceForecastInputError('cohortId is required');
    }

    const { model } = await loadMaterializedAudienceModelContext(platform);
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
    const context = await loadMaterializedAudienceModelContext(options.platform);
    const { loaded, model, qualityGate } = context;
    const { metadataIntegrity, loadStats } = loaded;
    const liftStabilityByCohort = await loadCohortLiftStabilityEvidence(
        options.platform,
        options.targetVideoId
    );
    console.info('analysis.audience-forecast.load', {
        platform: options.platform,
        snapshotCount: loadStats.snapshotCount,
        stitchedItemCount: loadStats.stitchedItemCount,
        metadataIntegrityScore: metadataIntegrity.metadataIntegrityScore,
        invalidMetadataSnapshots: metadataIntegrity.invalidMetadataSnapshots,
        durationMs: loadStats.durationMs,
        cacheStatus: loadStats.cacheStatus,
        watermarkKey: loadStats.watermarkKey,
    });
    return computeAudienceForecastFromModel(
        model,
        currentUserId,
        options,
        qualityGate,
        liftStabilityByCohort
    );
}

export {
    buildAudienceModel,
    computeReachProbability,
    deriveCohortLiftStabilityEvidence,
    deriveCohortStabilityScore,
    deriveRecommendationQualityGate,
    getRecommendationQualityThresholds,
    loadAudienceFeedItems,
};
