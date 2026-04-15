/**
 * Similarity matching service
 * Finds users with similar feed characteristics
 */

import { prisma } from '../lib/prisma.js';

interface SimilarFeed {
    snapshotId: string;
    userId: string;
    similarityScore: number;
    commonCreators: string[];
    capturedAt: Date;
}

/**
 * Find feeds similar to the user's feeds
 * Uses creator overlap as a basic similarity metric
 */
export async function findSimilarFeeds(
    userId: string,
    snapshotId?: string,
    limit: number = 10
): Promise<SimilarFeed[]> {
    // Get the user's creators from their feeds
    const userCreators = await prisma.feedItem.findMany({
        where: {
            snapshot: { userId },
            ...(snapshotId && { snapshotId }),
            creatorHandle: { not: null },
        },
        select: { creatorHandle: true },
        distinct: ['creatorHandle'],
    });

    const userCreatorSet = new Set(
        userCreators.map((c) => c.creatorHandle).filter(Boolean)
    );

    if (userCreatorSet.size === 0) {
        return [];
    }

    // Find other users' snapshots that have overlapping creators
    const otherSnapshots = await prisma.feedSnapshot.findMany({
        where: {
            userId: { not: userId },
        },
        include: {
            feedItems: {
                where: { creatorHandle: { not: null } },
                select: { creatorHandle: true },
            },
        },
        orderBy: { capturedAt: 'desc' },
        take: 100, // Consider last 100 snapshots for performance
    });

    // Calculate similarity scores
    const similarFeeds: SimilarFeed[] = [];

    for (const snapshot of otherSnapshots) {
        const snapshotCreators = new Set(
            snapshot.feedItems.map((i) => i.creatorHandle).filter(Boolean)
        );

        const commonCreators: string[] = [];
        for (const creator of snapshotCreators) {
            if (creator && userCreatorSet.has(creator)) {
                commonCreators.push(creator);
            }
        }

        if (commonCreators.length > 0) {
            // Jaccard similarity
            const union = new Set([...userCreatorSet, ...snapshotCreators]);
            const similarityScore = commonCreators.length / union.size;

            similarFeeds.push({
                snapshotId: snapshot.id,
                userId: snapshot.userId,
                similarityScore,
                commonCreators,
                capturedAt: snapshot.capturedAt,
            });
        }
    }

    // Sort by similarity and limit
    return similarFeeds
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, limit);
}
