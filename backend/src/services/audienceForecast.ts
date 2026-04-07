import { extractRecommendationsFromMetrics } from './recommendationParsing.js';
import { decompressAndUnpack, isCompressedMsgpack } from './serialization.js';

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
    score: number;
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
    qualityGate: RecommendationQualityGate;
    recommendedAudienceCohorts: CohortAudienceForecast[];
    cohorts: CohortAudienceForecast[];
}

export interface RecommendationQualityGate {
    status: 'ok' | 'degraded';
    parseCoverage: number;
    parserDropRate: number;
    minimumParseCoverage: number;
    confidenceMultiplier: number;
}

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

function decodeSessionMetadata(data: Buffer | null): Record<string, unknown> | null {
    if (!data) return null;
    try {
        const decoded = isCompressedMsgpack(data)
            ? decompressAndUnpack<unknown>(data)
            : JSON.parse(data.toString('utf-8'));
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
            return null;
        }
        return decoded as Record<string, unknown>;
    } catch {
        return null;
    }
}

function decodeMetrics(data: Buffer | null): unknown {
    if (!data) return null;
    try {
        return isCompressedMsgpack(data)
            ? decompressAndUnpack<unknown>(data)
            : JSON.parse(data.toString('utf-8'));
    } catch {
        return null;
    }
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

        const videoId = sanitizeString(item.videoId);
        if (!videoId) continue;

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
    return {
        status: 'ok',
        parseCoverage: 1,
        parserDropRate: 0,
        minimumParseCoverage: 0.2,
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

export function deriveRecommendationQualityGate(
    items: RawAudienceFeedItem[],
    platform: string,
    minimumParseCoverage = 0.2
): RecommendationQualityGate {
    let rawRecommendationRows = 0;
    let strictRecommendationRows = 0;

    for (const item of items) {
        if (!item.engagementMetrics) continue;
        const decoded = decodeMetrics(item.engagementMetrics);
        if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
            const recommendations = (decoded as { recommendations?: unknown }).recommendations;
            if (Array.isArray(recommendations)) {
                rawRecommendationRows += recommendations.length;
            }
        }

        const parsed = extractRecommendationsFromMetrics(item.engagementMetrics, {
            platform,
            sourceVideoId: item.videoId,
            maxRecommendations: 25,
        });
        strictRecommendationRows += parsed.length;
    }

    const parseCoverage = rawRecommendationRows > 0
        ? strictRecommendationRows / rawRecommendationRows
        : 0;
    const parserDropRate = rawRecommendationRows > 0
        ? 1 - parseCoverage
        : 0;
    const status: RecommendationQualityGate['status'] = parseCoverage >= minimumParseCoverage ? 'ok' : 'degraded';
    const confidenceMultiplier = status === 'ok'
        ? 1
        : clamp(0.45 + parseCoverage * 1.8, 0.45, 0.85);

    return {
        status,
        parseCoverage: roundTo(clamp(parseCoverage, 0, 1)),
        parserDropRate: roundTo(clamp(parserDropRate, 0, 1)),
        minimumParseCoverage: roundTo(clamp(minimumParseCoverage, 0, 1)),
        confidenceMultiplier: roundTo(confidenceMultiplier),
    };
}

export function computeAudienceForecastFromModel(
    model: AudienceModel,
    currentUserId: string,
    options: AudienceForecastOptions,
    qualityGate?: RecommendationQualityGate
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

        const relativeLift = globalExposureRate > 0
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
            score,
        });
    }

    cohorts.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.users !== a.users) return b.users - a.users;
        return a.cohortId.localeCompare(b.cohortId);
    });

    const recommendedAudienceCohorts = cohorts
        .filter((cohort) => cohort.users >= 2)
        .slice(0, 5);

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
            const metadata = decodeSessionMetadata(snapshot.sessionMetadata);
            const quality = asRecord(metadata?.quality);
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
                });
            }
        }
    }

    return stitchedItems;
}

export async function loadAudienceFeedItems(platform: string): Promise<RawAudienceFeedItem[]> {
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
        return [];
    }

    return stitchAndDedupeSnapshots(snapshots);
}

export async function getCohortUserIds(platform: string, cohortId: string): Promise<string[]> {
    const normalizedCohortId = cohortId.trim();
    if (!normalizedCohortId) {
        throw new AudienceForecastInputError('cohortId is required');
    }

    const items = await loadAudienceFeedItems(platform);
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
    const items = await loadAudienceFeedItems(options.platform);
    if (items.length === 0) {
        throw new AudienceForecastInputError(
            `No ${options.platform} comparison snapshots found yet.`,
            404,
            { platform: options.platform }
        );
    }

    const model = buildAudienceModel(items, options.platform);
    const qualityGate = deriveRecommendationQualityGate(items, options.platform);
    return computeAudienceForecastFromModel(model, currentUserId, options, qualityGate);
}
