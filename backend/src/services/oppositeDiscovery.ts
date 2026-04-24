import { prisma } from '../lib/prisma.js';
import {
    AudienceForecastInputError,
    buildAudienceModel,
    cohortLabel,
    loadMaterializedAudienceModelContext,
    normalizeTransitions,
    type AudienceModel,
    type CohortAggregate,
    type RecommendationQualityGate,
    type RawAudienceFeedItem,
    type UserProfile,
} from './audienceForecast.js';

const DEFAULT_CANDIDATE_LIMIT = 10;
const MAX_CANDIDATE_LIMIT = 20;
const MAX_OPPOSITE_COHORTS = 5;
const MAX_CANDIDATES_PER_COHORT = 4;
const MAX_BRIDGE_CONTENT = 5;
const BRIDGE_BEAM_WIDTH = 5;
const BRIDGE_MAX_DEPTH = 2;

type Band = 'low' | 'medium' | 'high';
type BubbleLevel = 'low' | 'medium' | 'high';

export interface OppositeDiscoveryBubbleSummary {
    score: number;
    level: BubbleLevel;
    dominantCategory: string;
    diversityBand: Band;
    loyaltyBand: Band;
    topCategoryShare: number;
    topCreatorShare: number;
    explanations: string[];
}

export interface OppositeDiscoveryCurrentCohort {
    cohortId: string;
    cohortLabel: string;
    users: number;
    materialized: boolean;
}

export interface OppositeDiscoveryCohort {
    cohortId: string;
    cohortLabel: string;
    users: number;
    distanceScore: number;
    dominantCategory: string;
    diversityBand: Band;
    loyaltyBand: Band;
    videoOverlap: number;
    transitionOverlap: number;
    whyFar: string[];
}

export interface OppositeDiscoveryCandidate {
    videoId: string;
    sourceCohortId: string;
    sourceCohortLabel: string;
    cohortExposureRate: number;
    currentCohortExposureRate: number;
    underexposureLift: number;
    distanceScore: number;
    score: number;
    explanations: string[];
}

export interface OppositeDiscoveryBridgeContent {
    videoId: string;
    sourceCohortId: string;
    sourceCohortLabel: string;
    pathSeeds: string[];
    bestPath: string[];
    pathReachProbability: number;
    underexposureLift: number;
    distanceScore: number;
    score: number;
    label: string;
}

export interface OppositeDiscoveryDiversityGap {
    dominantCategoryShare: number;
    outsideCurrentCohortCandidateCount: number;
    bridgeCandidateCount: number;
    distantCohortCount: number;
}

export interface OppositeDiscoveryResult {
    platform: string;
    bubble: OppositeDiscoveryBubbleSummary;
    currentCohort: OppositeDiscoveryCurrentCohort;
    oppositeCohorts: OppositeDiscoveryCohort[];
    candidates: OppositeDiscoveryCandidate[];
    bridgeContent: OppositeDiscoveryBridgeContent[];
    diversityGap: OppositeDiscoveryDiversityGap;
    qualityGate: RecommendationQualityGate;
}

export class OppositeDiscoveryInputError extends Error {
    statusCode: number;
    details?: Record<string, unknown>;

    constructor(message: string, statusCode = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'OppositeDiscoveryInputError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

interface OppositeDiscoveryOptions {
    platform: string;
    limit?: number;
}

interface CandidateAccumulator {
    videoId: string;
    sourceCohortId: string;
    sourceCohortLabel: string;
    cohortExposureRate: number;
    currentCohortExposureRate: number;
    underexposureLift: number;
    distanceScore: number;
    score: number;
    explanations: string[];
}

interface BridgePathSignal {
    pathSeeds: string[];
    bestPath: string[];
    pathReachProbability: number;
}

interface DistanceBreakdown {
    distanceScore: number;
    videoOverlap: number;
    transitionOverlap: number;
    categoryDistance: number;
    diversityDistance: number;
    loyaltyDistance: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, digits = 3) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function bandOrdinal(band: Band) {
    if (band === 'high') return 2;
    if (band === 'medium') return 1;
    return 0;
}

function bubbleLevel(score: number): BubbleLevel {
    if (score < 0.4) return 'low';
    if (score < 0.7) return 'medium';
    return 'high';
}

function bandPenalty(band: Band) {
    return bandOrdinal(band) / 2;
}

function ratioOverlap(left: Set<string>, right: Set<string>) {
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    const smaller = left.size <= right.size ? left : right;
    const larger = left.size <= right.size ? right : left;
    for (const value of smaller) {
        if (larger.has(value)) intersection += 1;
    }

    return intersection / Math.max(left.size, right.size);
}

function flattenTransitions(transitionCounts: Map<string, Map<string, number>>) {
    const flattened = new Map<string, number>();

    for (const [source, targets] of transitionCounts.entries()) {
        for (const [target, count] of targets.entries()) {
            const edgeKey = `${source}->${target}`;
            flattened.set(edgeKey, (flattened.get(edgeKey) ?? 0) + count);
        }
    }

    return flattened;
}

function weightedJaccard(left: Map<string, number>, right: Map<string, number>) {
    if (left.size === 0 || right.size === 0) return 0;

    const keys = new Set([...left.keys(), ...right.keys()]);
    let intersection = 0;
    let union = 0;

    for (const key of keys) {
        const leftWeight = left.get(key) ?? 0;
        const rightWeight = right.get(key) ?? 0;
        intersection += Math.min(leftWeight, rightWeight);
        union += Math.max(leftWeight, rightWeight);
    }

    return union > 0 ? intersection / union : 0;
}

function categoryDistance(currentUser: UserProfile, cohort: CohortAggregate) {
    if (currentUser.dominantCategory === cohort.dominantCategory) return 0;
    if (currentUser.dominantCategory === 'mixed' || cohort.dominantCategory === 'mixed') return 0.5;
    return 1;
}

export function summarizeBubble(profile: UserProfile): OppositeDiscoveryBubbleSummary {
    const score = roundTo(
        clamp(
            (profile.topCategoryShare * 0.35)
            + (profile.topCreatorShare * 0.25)
            + (bandPenalty(profile.diversityBand) * 0.2)
            + (bandPenalty(profile.loyaltyBand) * 0.1)
            + (profile.transitionConcentration * 0.1),
            0,
            1
        )
    );

    const explanations: string[] = [];
    if (profile.topCategoryShare >= 0.5) {
        explanations.push(`About ${Math.round(profile.topCategoryShare * 100)}% of your profile clusters in ${profile.dominantCategory}.`);
    }
    if (profile.topCreatorShare >= 0.25) {
        explanations.push(`A small set of creators accounts for roughly ${Math.round(profile.topCreatorShare * 100)}% of your viewing pattern.`);
    }
    if (profile.diversityBand === 'low') {
        explanations.push('Your creator diversity band is currently low.');
    }
    if (profile.loyaltyBand === 'high') {
        explanations.push('Your profile shows high creator loyalty, which can narrow discovery.');
    }
    if (profile.transitionConcentration >= 0.18) {
        explanations.push('A few recommendation transitions dominate your observed pathing.');
    }
    if (explanations.length === 0) {
        explanations.push('Your current profile still shows room for broader discovery.');
    }

    return {
        score,
        level: bubbleLevel(score),
        dominantCategory: profile.dominantCategory,
        diversityBand: profile.diversityBand,
        loyaltyBand: profile.loyaltyBand,
        topCategoryShare: profile.topCategoryShare,
        topCreatorShare: profile.topCreatorShare,
        explanations,
    };
}

export function computeCohortDistance(currentUser: UserProfile, cohort: CohortAggregate): DistanceBreakdown {
    const videoOverlap = roundTo(ratioOverlap(currentUser.seenVideos, cohort.seenVideos));
    const transitionOverlap = roundTo(
        weightedJaccard(flattenTransitions(currentUser.transitionCounts), flattenTransitions(cohort.transitionCounts))
    );
    const categoryGap = categoryDistance(currentUser, cohort);
    const diversityGap = Math.abs(bandOrdinal(currentUser.diversityBand) - bandOrdinal(cohort.diversityBand)) / 2;
    const loyaltyGap = Math.abs(bandOrdinal(currentUser.loyaltyBand) - bandOrdinal(cohort.loyaltyBand)) / 2;
    const distanceScore = roundTo(
        clamp(
            (categoryGap * 0.3)
            + (diversityGap * 0.15)
            + (loyaltyGap * 0.15)
            + ((1 - videoOverlap) * 0.2)
            + ((1 - transitionOverlap) * 0.2),
            0,
            1
        )
    );

    return {
        distanceScore,
        videoOverlap,
        transitionOverlap,
        categoryDistance: categoryGap,
        diversityDistance: roundTo(diversityGap),
        loyaltyDistance: roundTo(loyaltyGap),
    };
}

function explainCohortDistance(currentUser: UserProfile, cohort: CohortAggregate, breakdown: DistanceBreakdown) {
    const reasons: string[] = [];

    if (breakdown.categoryDistance >= 1) {
        reasons.push(`Different dominant category (${currentUser.dominantCategory} vs ${cohort.dominantCategory})`);
    } else if (breakdown.categoryDistance >= 0.5) {
        reasons.push('One side is mixed-category rather than tightly clustered');
    }
    if (breakdown.videoOverlap <= 0.2) {
        reasons.push('Very low seen-video overlap');
    }
    if (breakdown.transitionOverlap <= 0.2) {
        reasons.push('Very different recommendation transition patterns');
    }
    if (breakdown.diversityDistance >= 0.5) {
        reasons.push('Different diversity band');
    }
    if (breakdown.loyaltyDistance >= 0.5) {
        reasons.push('Different loyalty band');
    }

    if (reasons.length === 0) {
        reasons.push('This cohort is still meaningfully outside your current profile');
    }

    return reasons.slice(0, 3);
}

function rankCurrentUserSeeds(profile: UserProfile) {
    const ranked = new Map<string, number>();

    for (const [source, targets] of profile.transitionCounts.entries()) {
        let total = 0;
        for (const count of targets.values()) {
            total += count;
        }
        ranked.set(source, total);
    }

    for (const videoId of profile.seenVideos) {
        if (!ranked.has(videoId)) {
            ranked.set(videoId, 0.01);
        }
    }

    return Array.from(ranked.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([videoId]) => videoId);
}

function findBridgePath(
    profile: UserProfile,
    targetVideoId: string,
    model: AudienceModel
): BridgePathSignal | null {
    const normalizedTransitions = normalizeTransitions(model.globalTransitions);
    const rankedSeeds = rankCurrentUserSeeds(profile);
    const seedHits: Array<{ seed: string; probability: number; path: string[] }> = [];

    for (const seedVideoId of rankedSeeds) {
        const firstHop = normalizedTransitions.get(seedVideoId)?.slice(0, BRIDGE_BEAM_WIDTH) ?? [];
        let bestProbability = 0;
        let bestPath: string[] | null = null;

        for (const edge of firstHop) {
            if (edge.toVideoId === targetVideoId) {
                if (edge.probability > bestProbability) {
                    bestProbability = edge.probability;
                    bestPath = [seedVideoId, targetVideoId];
                }
                continue;
            }

            if (BRIDGE_MAX_DEPTH < 2) {
                continue;
            }

            const secondHop = normalizedTransitions.get(edge.toVideoId)?.slice(0, BRIDGE_BEAM_WIDTH) ?? [];
            for (const nextEdge of secondHop) {
                if (nextEdge.toVideoId !== targetVideoId) continue;

                const pathProbability = edge.probability * nextEdge.probability;
                if (pathProbability > bestProbability) {
                    bestProbability = pathProbability;
                    bestPath = [seedVideoId, edge.toVideoId, targetVideoId];
                }
            }
        }

        if (bestPath && bestProbability > 0) {
            seedHits.push({
                seed: seedVideoId,
                probability: roundTo(bestProbability),
                path: bestPath,
            });
        }
    }

    if (seedHits.length === 0) {
        return null;
    }

    seedHits.sort((left, right) => right.probability - left.probability || left.seed.localeCompare(right.seed));
    return {
        pathSeeds: seedHits.slice(0, 3).map((entry) => entry.seed),
        bestPath: seedHits[0].path,
        pathReachProbability: seedHits[0].probability,
    };
}

async function loadFallbackCurrentUserProfile(currentUserId: string, platform: string): Promise<UserProfile> {
    const feedItems = await prisma.feedItem.findMany({
        where: {
            snapshot: {
                userId: currentUserId,
                platform,
            },
        },
        select: {
            videoId: true,
            creatorHandle: true,
            contentCategories: true,
            engagementMetrics: true,
            snapshot: {
                select: {
                    capturedAt: true,
                },
            },
        },
        orderBy: [
            { snapshot: { capturedAt: 'asc' } },
            { positionInFeed: 'asc' },
        ],
        take: 6000,
    });

    const rawItems: RawAudienceFeedItem[] = feedItems.map((item) => ({
        userId: currentUserId,
        videoId: item.videoId,
        creatorHandle: item.creatorHandle,
        contentCategories: item.contentCategories,
        engagementMetrics: item.engagementMetrics,
        capturedAt: item.snapshot.capturedAt,
    }));

    const fallbackModel = buildAudienceModel(rawItems, platform);
    const profile = fallbackModel.userProfiles.get(currentUserId);
    if (!profile) {
        throw new OppositeDiscoveryInputError(
            `Not enough ${platform} history to compute opposite-spectrum discovery yet. Capture at least 3 usable items first.`,
            404,
            { platform, userId: currentUserId }
        );
    }

    return profile;
}

function buildCandidates(
    oppositeCohorts: OppositeDiscoveryCohort[],
    currentUser: UserProfile,
    currentCohort: CohortAggregate | null,
    model: AudienceModel,
    limit: number
) {
    const perVideoBest = new Map<string, CandidateAccumulator>();
    const uniqueVideoPool = new Set<string>();

    for (const oppositeCohort of oppositeCohorts) {
        const cohort = model.cohorts.get(oppositeCohort.cohortId);
        if (!cohort) continue;

        const cohortCandidates = Array.from(cohort.videoUserCounts.entries())
            .map(([videoId, cohortVideoUsers]) => {
                if (currentUser.seenVideos.has(videoId)) {
                    return null;
                }

                const cohortExposureRate = roundTo(cohort.users.length > 0 ? cohortVideoUsers / cohort.users.length : 0);
                const currentCohortExposureRate = roundTo(
                    currentCohort && currentCohort.users.length > 0
                        ? (currentCohort.videoUserCounts.get(videoId) ?? 0) / currentCohort.users.length
                        : 0
                );
                const underexposureLift = roundTo(cohortExposureRate - currentCohortExposureRate);
                if (underexposureLift <= 0) {
                    return null;
                }

                uniqueVideoPool.add(videoId);
                const score = roundTo(
                    clamp(
                        (cohortExposureRate * 0.45)
                        + (underexposureLift * 0.35)
                        + (oppositeCohort.distanceScore * 0.2),
                        0,
                        1
                    )
                );

                return {
                    videoId,
                    sourceCohortId: oppositeCohort.cohortId,
                    sourceCohortLabel: oppositeCohort.cohortLabel,
                    cohortExposureRate,
                    currentCohortExposureRate,
                    underexposureLift,
                    distanceScore: oppositeCohort.distanceScore,
                    score,
                    explanations: [
                        `Appears in ${Math.round(cohortExposureRate * 100)}% of ${oppositeCohort.cohortLabel}.`,
                        `Only ${Math.round(currentCohortExposureRate * 100)}% exposure in your current cohort.`,
                        'Comes from a cohort that is materially distant from your current profile.',
                    ],
                } satisfies CandidateAccumulator;
            })
            .filter((candidate): candidate is CandidateAccumulator => Boolean(candidate))
            .sort((left, right) => right.score - left.score || left.videoId.localeCompare(right.videoId))
            .slice(0, MAX_CANDIDATES_PER_COHORT);

        for (const candidate of cohortCandidates) {
            const existing = perVideoBest.get(candidate.videoId);
            if (!existing || candidate.score > existing.score) {
                perVideoBest.set(candidate.videoId, candidate);
            }
        }
    }

    const rankedCandidates = Array.from(perVideoBest.values())
        .sort((left, right) => right.score - left.score || left.videoId.localeCompare(right.videoId));

    return {
        totalUniqueCandidates: uniqueVideoPool.size,
        allCandidates: rankedCandidates,
        candidates: rankedCandidates.slice(0, limit),
    };
}

function buildBridgeContent(
    currentUser: UserProfile,
    candidatePool: CandidateAccumulator[],
    model: AudienceModel
) {
    return candidatePool
        .slice(0, Math.max(MAX_BRIDGE_CONTENT * 4, DEFAULT_CANDIDATE_LIMIT))
        .map((candidate) => {
            const bridgeSignal = findBridgePath(currentUser, candidate.videoId, model);
            if (!bridgeSignal) return null;

            const score = roundTo(
                clamp(
                    (bridgeSignal.pathReachProbability * 0.5)
                    + (candidate.underexposureLift * 0.3)
                    + (candidate.distanceScore * 0.2),
                    0,
                    1
                )
            );

            return {
                videoId: candidate.videoId,
                sourceCohortId: candidate.sourceCohortId,
                sourceCohortLabel: candidate.sourceCohortLabel,
                pathSeeds: bridgeSignal.pathSeeds,
                bestPath: bridgeSignal.bestPath,
                pathReachProbability: bridgeSignal.pathReachProbability,
                underexposureLift: candidate.underexposureLift,
                distanceScore: candidate.distanceScore,
                score,
                label: 'Common elsewhere, reachable from what you already watch',
            } satisfies OppositeDiscoveryBridgeContent;
        })
        .filter((bridge): bridge is OppositeDiscoveryBridgeContent => Boolean(bridge))
        .sort((left, right) => right.score - left.score || left.videoId.localeCompare(right.videoId))
        .slice(0, MAX_BRIDGE_CONTENT);
}

export function computeOppositeDiscoveryFromModel(
    model: AudienceModel,
    currentUser: UserProfile,
    platform: string,
    qualityGate: RecommendationQualityGate,
    limit = DEFAULT_CANDIDATE_LIMIT,
    currentUserIsMaterialized = true
): OppositeDiscoveryResult {
    const boundedLimit = clamp(limit, 1, MAX_CANDIDATE_LIMIT);
    const minimumCohortUsers = qualityGate.minimumCohortUsersForLift;
    const currentCohort = model.cohorts.get(currentUser.cohortId) ?? null;
    const currentCohortSummary: OppositeDiscoveryCurrentCohort = {
        cohortId: currentUser.cohortId,
        cohortLabel: cohortLabel(currentUser.cohortId),
        users: currentCohort?.users.length ?? 1,
        materialized: currentUserIsMaterialized,
    };

    const oppositeCohorts = Array.from(model.cohorts.values())
        .filter((cohort) => cohort.cohortId !== currentUser.cohortId && cohort.users.length >= minimumCohortUsers)
        .map((cohort) => {
            const distance = computeCohortDistance(currentUser, cohort);
            return {
                cohortId: cohort.cohortId,
                cohortLabel: cohortLabel(cohort.cohortId),
                users: cohort.users.length,
                distanceScore: distance.distanceScore,
                dominantCategory: cohort.dominantCategory,
                diversityBand: cohort.diversityBand,
                loyaltyBand: cohort.loyaltyBand,
                videoOverlap: distance.videoOverlap,
                transitionOverlap: distance.transitionOverlap,
                whyFar: explainCohortDistance(currentUser, cohort, distance),
            } satisfies OppositeDiscoveryCohort;
        })
        .sort((left, right) => right.distanceScore - left.distanceScore || left.cohortId.localeCompare(right.cohortId))
        .slice(0, MAX_OPPOSITE_COHORTS);

    const candidateSummary = buildCandidates(oppositeCohorts, currentUser, currentCohort, model, boundedLimit);
    const bridgeContent = buildBridgeContent(currentUser, candidateSummary.allCandidates, model);

    return {
        platform,
        bubble: summarizeBubble(currentUser),
        currentCohort: currentCohortSummary,
        oppositeCohorts,
        candidates: candidateSummary.candidates,
        bridgeContent,
        diversityGap: {
            dominantCategoryShare: currentUser.topCategoryShare,
            outsideCurrentCohortCandidateCount: candidateSummary.totalUniqueCandidates,
            bridgeCandidateCount: bridgeContent.length,
            distantCohortCount: oppositeCohorts.length,
        },
        qualityGate,
    };
}

export async function generateOppositeDiscovery(
    currentUserId: string,
    options: OppositeDiscoveryOptions
): Promise<OppositeDiscoveryResult> {
    const platform = options.platform.trim().toLowerCase();
    const limit = clamp(options.limit ?? DEFAULT_CANDIDATE_LIMIT, 1, MAX_CANDIDATE_LIMIT);

    try {
        const context = await loadMaterializedAudienceModelContext(platform);
        const currentUserFromMaterializedModel = context.model.userProfiles.get(currentUserId);
        const currentUser = currentUserFromMaterializedModel
            ?? await loadFallbackCurrentUserProfile(currentUserId, platform);

        return computeOppositeDiscoveryFromModel(
            context.model,
            currentUser,
            platform,
            context.qualityGate,
            limit,
            Boolean(currentUserFromMaterializedModel)
        );
    } catch (error) {
        if (error instanceof OppositeDiscoveryInputError || error instanceof AudienceForecastInputError) {
            throw error;
        }

        throw error;
    }
}
