/**
 * Similarity matching service
 * Finds snapshots with a similar recommendation profile on the same platform.
 */

import { prisma } from '../lib/prisma.js';

const MAX_CANDIDATE_SNAPSHOTS = 150;
const MAX_MATCH_PREVIEW_ITEMS = 5;
const MIN_SIMILARITY_SCORE = 0.12;
const TOP_CREATOR_FILTER_COUNT = 12;
const TOP_CATEGORY_FILTER_COUNT = 10;

interface SimilarityFeedItem {
    creatorHandle: string | null;
    contentCategories: string[];
    interactionType: string | null;
    interacted: boolean;
    watchDuration: number | null;
    positionInFeed: number;
}

interface SnapshotProfile {
    creators: Map<string, number>;
    categories: Map<string, number>;
    interactionTypes: Map<string, number>;
    interactedRate: number;
    avgWatchDuration: number;
    earlyFeedShare: number;
}

interface SimilarityBreakdown {
    creatorOverlap: number;
    categoryOverlap: number;
    behaviorAlignment: number;
}

interface SimilarFeed {
    snapshotId: string;
    userId: string;
    platform: string;
    similarityScore: number;
    commonCreators: string[];
    commonCategories: string[];
    signalBreakdown: SimilarityBreakdown;
    matchingSignals: string[];
    capturedAt: Date;
}

export interface SimilarFeedSearchResult {
    similarFeeds: SimilarFeed[];
    candidateCount: number;
    targetSnapshotId: string | null;
    method: string;
}

function normalizeLabel(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

function buildWeight(positionInFeed: number, interacted: boolean, watchDuration: number | null): number {
    const normalizedPosition = Math.max(0, Number.isFinite(positionInFeed) ? positionInFeed : 0);
    const earlyFeedBoost = Math.max(0, 1 - (normalizedPosition / 20)) * 0.5;
    const interactionBoost = interacted ? 0.75 : 0;
    const watchBoost = Math.min(1, Math.max(0, watchDuration ?? 0) / 20) * 0.5;

    return 1 + earlyFeedBoost + interactionBoost + watchBoost;
}

function incrementWeight(map: Map<string, number>, key: string | null, weight: number) {
    if (!key) {
        return;
    }

    map.set(key, (map.get(key) ?? 0) + weight);
}

function buildSnapshotProfile(feedItems: SimilarityFeedItem[]): SnapshotProfile {
    const creators = new Map<string, number>();
    const categories = new Map<string, number>();
    const interactionTypes = new Map<string, number>();

    let totalWeight = 0;
    let interactedWeight = 0;
    let totalWatchWeight = 0;
    let totalWatchWeightedSeconds = 0;
    let earlyFeedWeightedItems = 0;

    for (const item of feedItems) {
        const creatorHandle = normalizeLabel(item.creatorHandle);
        const interactionType = normalizeLabel(item.interactionType);
        const watchDuration = Number.isFinite(item.watchDuration ?? NaN) ? Math.max(0, item.watchDuration ?? 0) : 0;
        const weight = buildWeight(item.positionInFeed, item.interacted, watchDuration);

        totalWeight += weight;
        if (item.interacted) {
            interactedWeight += weight;
        }

        totalWatchWeight += weight;
        totalWatchWeightedSeconds += weight * watchDuration;
        if ((item.positionInFeed ?? 0) <= 10) {
            earlyFeedWeightedItems += weight;
        }

        incrementWeight(creators, creatorHandle, weight);
        incrementWeight(interactionTypes, interactionType, weight);

        for (const category of Array.isArray(item.contentCategories) ? item.contentCategories : []) {
            incrementWeight(categories, normalizeLabel(category), weight);
        }
    }

    return {
        creators,
        categories,
        interactionTypes,
        interactedRate: totalWeight > 0 ? interactedWeight / totalWeight : 0,
        avgWatchDuration: totalWatchWeight > 0 ? totalWatchWeightedSeconds / totalWatchWeight : 0,
        earlyFeedShare: totalWeight > 0 ? earlyFeedWeightedItems / totalWeight : 0,
    };
}

function weightedJaccard(left: Map<string, number>, right: Map<string, number>): number {
    if (left.size === 0 || right.size === 0) {
        return 0;
    }

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

function topSharedKeys(left: Map<string, number>, right: Map<string, number>, limit: number): string[] {
    const shared = Array.from(left.entries())
        .map(([key, leftWeight]) => ({
            key,
            score: Math.min(leftWeight, right.get(key) ?? 0),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
        .slice(0, limit)
        .map((entry) => entry.key);

    return shared;
}

function topKeys(map: Map<string, number>, limit: number): string[] {
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key]) => key);
}

function computeBehaviorAlignment(target: SnapshotProfile, candidate: SnapshotProfile): number {
    const interactionTypeOverlap = weightedJaccard(target.interactionTypes, candidate.interactionTypes);
    const interactedAlignment = 1 - Math.min(1, Math.abs(target.interactedRate - candidate.interactedRate));
    const watchAlignment = 1 - Math.min(1, Math.abs(target.avgWatchDuration - candidate.avgWatchDuration) / 30);
    const earlyFeedAlignment = 1 - Math.min(1, Math.abs(target.earlyFeedShare - candidate.earlyFeedShare));

    return (
        (interactionTypeOverlap * 0.35)
        + (interactedAlignment * 0.25)
        + (watchAlignment * 0.2)
        + (earlyFeedAlignment * 0.2)
    );
}

function computeSimilarityBreakdown(target: SnapshotProfile, candidate: SnapshotProfile): SimilarityBreakdown {
    return {
        creatorOverlap: weightedJaccard(target.creators, candidate.creators),
        categoryOverlap: weightedJaccard(target.categories, candidate.categories),
        behaviorAlignment: computeBehaviorAlignment(target, candidate),
    };
}

function scoreSimilarity(breakdown: SimilarityBreakdown): number {
    return (
        (breakdown.creatorOverlap * 0.55)
        + (breakdown.categoryOverlap * 0.3)
        + (breakdown.behaviorAlignment * 0.15)
    );
}

function describeMatchingSignals(breakdown: SimilarityBreakdown): string[] {
    const signals: string[] = [];

    if (breakdown.creatorOverlap >= 0.15) {
        signals.push('creator-overlap');
    }
    if (breakdown.categoryOverlap >= 0.18) {
        signals.push('category-overlap');
    }
    if (breakdown.behaviorAlignment >= 0.65) {
        signals.push('behavior-alignment');
    }

    return signals;
}

type SnapshotWithItems = {
    id: string;
    userId: string;
    platform: string;
    capturedAt: Date;
    feedItems: SimilarityFeedItem[];
};

async function loadTargetSnapshot(userId: string, snapshotId?: string): Promise<SnapshotWithItems | null> {
    if (snapshotId) {
        const snapshot = await prisma.feedSnapshot.findUnique({
            where: { id: snapshotId },
            select: {
                id: true,
                userId: true,
                platform: true,
                capturedAt: true,
                feedItems: {
                    select: {
                        creatorHandle: true,
                        contentCategories: true,
                        interactionType: true,
                        interacted: true,
                        watchDuration: true,
                        positionInFeed: true,
                    },
                },
            },
        });

        if (!snapshot || snapshot.userId !== userId) {
            return null;
        }

        return snapshot;
    }

    return prisma.feedSnapshot.findFirst({
        where: { userId },
        orderBy: { capturedAt: 'desc' },
        select: {
            id: true,
            userId: true,
            platform: true,
            capturedAt: true,
            feedItems: {
                select: {
                    creatorHandle: true,
                    contentCategories: true,
                    interactionType: true,
                    interacted: true,
                    watchDuration: true,
                    positionInFeed: true,
                },
            },
        },
    });
}

/**
 * Find feed snapshots similar to the user's current snapshot.
 * Uses a weighted snapshot profile on the same platform instead of raw handle overlap.
 */
export async function findSimilarFeeds(
    userId: string,
    snapshotId?: string,
    limit: number = 10
): Promise<SimilarFeedSearchResult> {
    const targetSnapshot = await loadTargetSnapshot(userId, snapshotId);
    if (!targetSnapshot || targetSnapshot.feedItems.length === 0) {
        return {
            similarFeeds: [],
            candidateCount: 0,
            targetSnapshotId: targetSnapshot?.id ?? null,
            method: 'weighted-snapshot-profile-v1',
        };
    }

    const targetProfile = buildSnapshotProfile(targetSnapshot.feedItems);
    const topCreators = topKeys(targetProfile.creators, TOP_CREATOR_FILTER_COUNT);
    const topCategories = topKeys(targetProfile.categories, TOP_CATEGORY_FILTER_COUNT);

    const candidateSignals: any[] = [];
    if (topCreators.length > 0) {
        candidateSignals.push({ creatorHandle: { in: topCreators } });
    }
    if (topCategories.length > 0) {
        candidateSignals.push({ contentCategories: { hasSome: topCategories } });
    }

    const candidateSnapshots = await prisma.feedSnapshot.findMany({
        where: {
            userId: { not: userId },
            platform: targetSnapshot.platform,
            ...(candidateSignals.length > 0
                ? {
                    feedItems: {
                        some: {
                            OR: candidateSignals,
                        },
                    },
                }
                : {}),
        },
        select: {
            id: true,
            userId: true,
            platform: true,
            capturedAt: true,
            feedItems: {
                select: {
                    creatorHandle: true,
                    contentCategories: true,
                    interactionType: true,
                    interacted: true,
                    watchDuration: true,
                    positionInFeed: true,
                },
            },
        },
        orderBy: { capturedAt: 'desc' },
        take: MAX_CANDIDATE_SNAPSHOTS,
    });

    const bestSnapshotByUser = new Map<string, SimilarFeed>();

    for (const snapshot of candidateSnapshots) {
        if (snapshot.feedItems.length === 0) {
            continue;
        }

        const candidateProfile = buildSnapshotProfile(snapshot.feedItems);
        const breakdown = computeSimilarityBreakdown(targetProfile, candidateProfile);
        const similarityScore = scoreSimilarity(breakdown);
        if (similarityScore < MIN_SIMILARITY_SCORE) {
            continue;
        }

        const candidate: SimilarFeed = {
            snapshotId: snapshot.id,
            userId: snapshot.userId,
            platform: snapshot.platform,
            similarityScore,
            commonCreators: topSharedKeys(targetProfile.creators, candidateProfile.creators, MAX_MATCH_PREVIEW_ITEMS),
            commonCategories: topSharedKeys(targetProfile.categories, candidateProfile.categories, MAX_MATCH_PREVIEW_ITEMS),
            signalBreakdown: breakdown,
            matchingSignals: describeMatchingSignals(breakdown),
            capturedAt: snapshot.capturedAt,
        };

        const existing = bestSnapshotByUser.get(snapshot.userId);
        if (!existing || candidate.similarityScore > existing.similarityScore) {
            bestSnapshotByUser.set(snapshot.userId, candidate);
        }
    }

    return {
        similarFeeds: Array.from(bestSnapshotByUser.values())
            .sort((a, b) => b.similarityScore - a.similarityScore)
            .slice(0, limit),
        candidateCount: candidateSnapshots.length,
        targetSnapshotId: targetSnapshot.id,
        method: 'weighted-snapshot-profile-v1',
    };
}
