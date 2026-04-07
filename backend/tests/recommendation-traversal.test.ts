import { describe, expect, it } from 'vitest';
import {
    buildRecommendationGraph,
    SourceFeedItem,
    traverseRecommendationGraph,
    TraversalInputError,
} from '../src/services/recommendationTraversal';

function createItem(
    videoId: string,
    recommendations: Array<{ videoId: string; position: number; title?: string; channel?: string }>,
    caption = `${videoId} title`,
    creatorHandle = `${videoId.toLowerCase()}-creator`
): SourceFeedItem {
    return {
        videoId,
        caption,
        creatorHandle,
        // Use JSON buffer in tests to avoid depending on zstd runtime bindings.
        engagementMetrics: Buffer.from(JSON.stringify({ recommendations }), 'utf-8'),
    };
}

const fixtureItems: SourceFeedItem[] = [
    createItem('vidA', [
        { videoId: 'vidB', position: 1, title: 'B-title', channel: 'B-channel' },
        { videoId: 'vidC', position: 2, title: 'C-title', channel: 'C-channel' },
    ]),
    createItem('vidA', [
        { videoId: 'vidB', position: 1, title: 'B-title', channel: 'B-channel' },
    ]),
    createItem('vidB', [
        { videoId: 'vidD', position: 1 },
        { videoId: 'vidE', position: 2 },
    ]),
    createItem('vidC', [
        { videoId: 'vidF', position: 1 },
        { videoId: 'vidA', position: 2 },
    ]),
    createItem('vidD', [
        { videoId: 'vidG', position: 1 },
    ]),
    createItem('vidE', [
        { videoId: 'vidB', position: 1 },
    ]),
    createItem('vidF', []),
    createItem('vidG', []),
];

describe('Recommendation traversal', () => {
    it('runs BFS with level-order expansion and loop detection', () => {
        const graph = buildRecommendationGraph(fixtureItems);
        const result = traverseRecommendationGraph(graph, {
            seedVideoId: 'vidA',
            strategy: 'bfs',
            maxDepth: 3,
            maxNodes: 20,
            platform: 'youtube',
        });

        expect(result.visitOrder.map((step) => step.videoId)).toEqual(['vidA', 'vidB', 'vidC', 'vidD', 'vidE', 'vidF', 'vidG']);
        expect(result.summary.loopEdgeCount).toBe(2);
        expect(result.visitOrder[0].predictedNextVideoId).toBe('vidB');
        expect(result.visitOrder[0].predictedConfidence).toBeGreaterThan(0.6);
    });

    it('runs DFS by following top recommendations first', () => {
        const graph = buildRecommendationGraph(fixtureItems);
        const result = traverseRecommendationGraph(graph, {
            seedVideoId: 'vidA',
            strategy: 'dfs',
            maxDepth: 3,
            maxNodes: 20,
            platform: 'youtube',
        });

        expect(result.visitOrder.map((step) => step.videoId)).toEqual(['vidA', 'vidB', 'vidD', 'vidG', 'vidE', 'vidC', 'vidF']);
        expect(result.summary.maxDepthReached).toBe(3);
        expect(result.summary.totalVisitedVideos).toBe(7);
    });

    it('throws a typed error when seed is missing from graph', () => {
        const graph = buildRecommendationGraph(fixtureItems);

        try {
            traverseRecommendationGraph(graph, {
                seedVideoId: 'NOT_FOUND',
                strategy: 'bfs',
                maxDepth: 3,
                maxNodes: 20,
                platform: 'youtube',
            });
            throw new Error('Expected traversal to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(TraversalInputError);
            const typedError = error as TraversalInputError;
            expect(typedError.details?.suggestions).toContain('vidA');
        }
    });
});
