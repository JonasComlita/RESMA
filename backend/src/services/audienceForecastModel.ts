import {
    extractRecommendationsFromMetrics,
    normalizeRecommendationVideoId,
} from './recommendationParsing.js';
import { sanitizeString } from '../lib/ingestUtils.js';
import type {
    AudienceModel,
    CohortAggregate,
    CohortAudienceForecast,
    CohortLiftInterpretation,
    CohortLiftStabilityEvidence,
    CohortStabilityConstraints,
    RawAudienceFeedItem,
    UserProfile,
} from './audienceForecast.js';

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

interface TransitionProbability {
    toVideoId: string;
    count: number;
    probability: number;
}

export type TransitionProbabilityMap = Map<string, TransitionProbability[]>;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
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

export function cohortLabel(cohortId: string) {
    const [category, diversity, loyalty] = cohortId.split('|');
    return `${category} / ${diversity} discovery / ${loyalty} loyalty`;
}

export function wilsonInterval(successes: number, trials: number, z = 1.96) {
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

export function normalizeTransitions(
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

export function directProbability(
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

export function deriveFitScore(currentUser: UserProfile | undefined, cohort: CohortAggregate) {
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

export function deriveNetworkStrength(comparedUsers: number, comparedTransitions: number) {
    const userSignal = 1 - Math.exp(-comparedUsers / 40);
    const transitionSignal = 1 - Math.exp(-comparedTransitions / 4000);
    return roundTo(clamp(userSignal * 0.6 + transitionSignal * 0.4, 0, 1));
}

export function countTransitionSamples(transitionCounts: Map<string, Map<string, number>>) {
    let total = 0;
    for (const targets of transitionCounts.values()) {
        for (const count of targets.values()) {
            total += count;
        }
    }
    return total;
}

function deriveTransitionConcentration(transitionCounts: Map<string, Map<string, number>>) {
    let total = 0;
    let strongestEdge = 0;

    for (const targets of transitionCounts.values()) {
        for (const count of targets.values()) {
            total += count;
            strongestEdge = Math.max(strongestEdge, count);
        }
    }

    if (total <= 0) return 0;
    return roundTo(clamp(strongestEdge / total, 0, 1));
}

export function evaluateLiftInterpretation(
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
        topCategoryShare: number;
        topCreatorShare: number;
        uniqueCreatorRatio: number;
        transitionConcentration: number;
        categoryCounts: Map<string, number>;
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
        const uniqueCreatorRatio = profile.totalItems > 0 ? uniqueCreators / profile.totalItems : 0;
        const loyaltyBand = assignLoyaltyBand(topCreatorShare, profile.totalItems);
        const transitionConcentration = deriveTransitionConcentration(profile.transitionCounts);
        const rawCohortId = buildInitialCohortId(stableCategory, diversityBand, loyaltyBand);
        rawCohortCounts.set(rawCohortId, (rawCohortCounts.get(rawCohortId) ?? 0) + 1);

        provisionalProfiles.set(userId, {
            userId,
            totalItems: profile.totalItems,
            dominantCategory: stableCategory,
            diversityBand,
            loyaltyBand,
            topCategoryShare: roundTo(clamp(dominantCategoryShare, 0, 1)),
            topCreatorShare: roundTo(clamp(topCreatorShare, 0, 1)),
            uniqueCreatorRatio: roundTo(clamp(uniqueCreatorRatio, 0, 1)),
            transitionConcentration,
            categoryCounts: new Map(profile.categoryCounts),
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
            topCategoryShare: profile.topCategoryShare,
            topCreatorShare: profile.topCreatorShare,
            uniqueCreatorRatio: profile.uniqueCreatorRatio,
            transitionConcentration: profile.transitionConcentration,
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
                seenVideos: new Set<string>(),
                videoUserCounts: new Map<string, number>(),
                topCategories: new Map<string, number>(),
                transitionCounts: new Map<string, Map<string, number>>(),
            };
            cohorts.set(cohortId, cohort);
        }

        cohort.users.push(userId);
        for (const videoId of profile.seenVideos) {
            cohort.seenVideos.add(videoId);
            cohort.videoUserCounts.set(videoId, (cohort.videoUserCounts.get(videoId) ?? 0) + 1);
        }
        for (const [category, count] of profile.categoryCounts.entries()) {
            cohort.topCategories.set(category, (cohort.topCategories.get(category) ?? 0) + count);
        }
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
