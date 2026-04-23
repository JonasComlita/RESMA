import { prisma } from '../lib/prisma.js';
import { extractRecommendationsFromMetrics } from './recommendationParsing.js';
import { sanitizeString } from '../lib/ingestUtils.js';

export type TraversalStrategy = 'bfs' | 'dfs';

export interface RecommendationTraversalOptions {
    seedVideoId: string;
    strategy: TraversalStrategy;
    maxDepth: number;
    maxNodes: number;
    platform: string;
}

export interface TraversalVisitStep {
    step: number;
    videoId: string;
    depth: number;
    fromVideoId: string | null;
    predictedNextVideoId: string | null;
    predictedConfidence: number | null;
    outgoingRecommendationCount: number;
}

export interface TraversalLoopEdge {
    fromVideoId: string;
    toVideoId: string;
    fromDepth: number;
    seenAtDepth: number;
    confidence: number;
    count: number;
}

export interface TraversalNode {
    videoId: string;
    title: string | null;
    channel: string | null;
    depth: number;
    observations: number;
    outgoingCount: number;
    incomingCount: number;
}

export interface TraversalEdge {
    fromVideoId: string;
    toVideoId: string;
    count: number;
    avgRank: number;
    confidence: number;
    title: string | null;
    channel: string | null;
    connectsVisitedNodes: boolean;
}

export interface RecommendationTraversalResult {
    strategy: TraversalStrategy;
    seedVideoId: string;
    platform: string;
    maxDepth: number;
    maxNodes: number;
    summary: {
        totalVisitedVideos: number;
        maxDepthReached: number;
        loopEdgeCount: number;
        avgPredictionConfidence: number;
        repeatedTransitionRate: number;
    };
    visitOrder: TraversalVisitStep[];
    nodes: TraversalNode[];
    edges: TraversalEdge[];
    loopEdges: TraversalLoopEdge[];
}

export interface RecommendationMapOptions {
    seedVideoId: string;
    maxDepth: number;
    maxNodes: number;
    platform: string;
}

export interface CombinedRecommendationNode {
    videoId: string;
    title: string | null;
    channel: string | null;
    bfsDepth: number | null;
    dfsDepth: number | null;
    discoveredBy: 'bfs' | 'dfs' | 'both';
}

export interface RecommendationMapResult {
    seedVideoId: string;
    platform: string;
    maxDepth: number;
    maxNodes: number;
    scope?: {
        type: 'personal' | 'cohort';
        userCount: number;
        cohortId?: string;
    };
    summary: {
        sharedVideos: number;
        bfsUniqueVideos: number;
        dfsUniqueVideos: number;
        sharedRate: number;
        avgPredictionConfidence: number;
        totalLoopEdges: number;
    };
    bfs: RecommendationTraversalResult;
    dfs: RecommendationTraversalResult;
    combinedNodes: CombinedRecommendationNode[];
}

export class TraversalInputError extends Error {
    statusCode: number;
    details?: Record<string, unknown>;

    constructor(message: string, statusCode = 400, details?: Record<string, unknown>) {
        super(message);
        this.name = 'TraversalInputError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

export interface SourceFeedItem {
    videoId: string;
    creatorHandle: string | null;
    caption: string | null;
    engagementMetrics: Buffer | null;
}

interface NormalizedRecommendation {
    videoId: string;
    title: string | null;
    channel: string | null;
    position: number;
}

interface GraphNodeMeta {
    videoId: string;
    title: string | null;
    channel: string | null;
    observations: number;
    outgoingCount: number;
    incomingCount: number;
}

interface GraphEdgeMeta {
    toVideoId: string;
    count: number;
    avgRank: number;
    confidence: number;
    title: string | null;
    channel: string | null;
}

export interface RecommendationGraph {
    nodes: Map<string, GraphNodeMeta>;
    adjacency: Map<string, GraphEdgeMeta[]>;
}

interface GraphBuildInput {
    videoId: string;
    title: string | null;
    channel: string | null;
    recommendations: NormalizedRecommendation[];
}

function extractRecommendations(metrics: Buffer | null, platform: string): NormalizedRecommendation[] {
    return extractRecommendationsFromMetrics(metrics, {
        platform,
        maxRecommendations: 25,
    });
}

function dominantValue(counts: Map<string, number>): string | null {
    let winner: string | null = null;
    let winnerCount = 0;

    for (const [value, count] of counts.entries()) {
        if (count > winnerCount) {
            winner = value;
            winnerCount = count;
        }
    }

    return winner;
}

function roundTo(value: number, digits = 3): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function normalizeGraphInput(items: SourceFeedItem[], platform: string): GraphBuildInput[] {
    return items
        .map((item) => {
            const videoId = sanitizeString(item.videoId);
            if (!videoId) return null;

            return {
                videoId,
                title: sanitizeString(item.caption),
                channel: sanitizeString(item.creatorHandle),
                recommendations: extractRecommendations(item.engagementMetrics, platform),
            };
        })
        .filter((item): item is GraphBuildInput => item !== null);
}

export function buildRecommendationGraph(items: SourceFeedItem[], platform = 'youtube'): RecommendationGraph {
    const graphItems = normalizeGraphInput(items, platform);

    const nodeCounters = new Map<string, {
        observations: number;
        titles: Map<string, number>;
        channels: Map<string, number>;
    }>();

    const edgeCounters = new Map<string, Map<string, {
        count: number;
        rankSum: number;
        titles: Map<string, number>;
        channels: Map<string, number>;
    }>>();

    const ensureNodeCounter = (videoId: string) => {
        let current = nodeCounters.get(videoId);
        if (!current) {
            current = {
                observations: 0,
                titles: new Map<string, number>(),
                channels: new Map<string, number>(),
            };
            nodeCounters.set(videoId, current);
        }
        return current;
    };

    const countNamedValue = (counter: Map<string, number>, value: string | null) => {
        if (!value) return;
        counter.set(value, (counter.get(value) ?? 0) + 1);
    };

    for (const item of graphItems) {
        const sourceNode = ensureNodeCounter(item.videoId);
        sourceNode.observations += 1;
        countNamedValue(sourceNode.titles, item.title);
        countNamedValue(sourceNode.channels, item.channel);

        for (const recommendation of item.recommendations) {
            const targetNode = ensureNodeCounter(recommendation.videoId);
            targetNode.observations += 1;
            countNamedValue(targetNode.titles, recommendation.title);
            countNamedValue(targetNode.channels, recommendation.channel);

            let sourceEdges = edgeCounters.get(item.videoId);
            if (!sourceEdges) {
                sourceEdges = new Map();
                edgeCounters.set(item.videoId, sourceEdges);
            }

            let edge = sourceEdges.get(recommendation.videoId);
            if (!edge) {
                edge = {
                    count: 0,
                    rankSum: 0,
                    titles: new Map<string, number>(),
                    channels: new Map<string, number>(),
                };
                sourceEdges.set(recommendation.videoId, edge);
            }

            edge.count += 1;
            edge.rankSum += recommendation.position;
            countNamedValue(edge.titles, recommendation.title);
            countNamedValue(edge.channels, recommendation.channel);
        }
    }

    const outgoingCounts = new Map<string, number>();
    const incomingCounts = new Map<string, number>();
    const adjacency = new Map<string, GraphEdgeMeta[]>();

    for (const [sourceVideoId, edges] of edgeCounters.entries()) {
        let totalOutgoing = 0;
        for (const edge of edges.values()) {
            totalOutgoing += edge.count;
        }

        outgoingCounts.set(sourceVideoId, edges.size);

        const normalizedEdges: GraphEdgeMeta[] = [];
        for (const [toVideoId, edge] of edges.entries()) {
            incomingCounts.set(toVideoId, (incomingCounts.get(toVideoId) ?? 0) + 1);

            normalizedEdges.push({
                toVideoId,
                count: edge.count,
                avgRank: roundTo(edge.rankSum / edge.count, 2),
                confidence: totalOutgoing > 0 ? roundTo(edge.count / totalOutgoing) : 0,
                title: dominantValue(edge.titles),
                channel: dominantValue(edge.channels),
            });
        }

        normalizedEdges.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
            return a.toVideoId.localeCompare(b.toVideoId);
        });

        adjacency.set(sourceVideoId, normalizedEdges);
    }

    const nodes = new Map<string, GraphNodeMeta>();

    for (const [videoId, counts] of nodeCounters.entries()) {
        nodes.set(videoId, {
            videoId,
            title: dominantValue(counts.titles),
            channel: dominantValue(counts.channels),
            observations: counts.observations,
            outgoingCount: outgoingCounts.get(videoId) ?? 0,
            incomingCount: incomingCounts.get(videoId) ?? 0,
        });
    }

    return { nodes, adjacency };
}

interface FrontierItem {
    videoId: string;
    depth: number;
    fromVideoId: string | null;
}

function collectSeedSuggestions(graph: RecommendationGraph, limit = 5): string[] {
    const candidates: Array<{ videoId: string; score: number }> = [];

    for (const [videoId, edges] of graph.adjacency.entries()) {
        const score = edges.reduce((total, edge) => total + edge.count, 0);
        candidates.push({ videoId, score });
    }

    candidates.sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId));

    return candidates.slice(0, limit).map((candidate) => candidate.videoId);
}

export function traverseRecommendationGraph(
    graph: RecommendationGraph,
    options: RecommendationTraversalOptions
): RecommendationTraversalResult {
    const seedVideoId = options.seedVideoId.trim();
    if (!graph.nodes.has(seedVideoId)) {
        throw new TraversalInputError(
            'Seed video was not found in your captured recommendation graph.',
            404,
            {
                seedVideoId,
                suggestions: collectSeedSuggestions(graph),
            }
        );
    }

    const frontier: FrontierItem[] = [{
        videoId: seedVideoId,
        depth: 0,
        fromVideoId: null,
    }];

    const inFrontier = new Set<string>([seedVideoId]);
    const visitedDepth = new Map<string, number>();
    const visitOrder: TraversalVisitStep[] = [];
    const loopEdges: TraversalLoopEdge[] = [];

    const takeNext = () => {
        if (options.strategy === 'bfs') {
            return frontier.shift();
        }
        return frontier.pop();
    };

    while (frontier.length > 0 && visitOrder.length < options.maxNodes) {
        const current = takeNext();
        if (!current) break;
        inFrontier.delete(current.videoId);

        if (current.depth > options.maxDepth) continue;
        if (visitedDepth.has(current.videoId)) continue;

        visitedDepth.set(current.videoId, current.depth);
        const outgoingEdges = graph.adjacency.get(current.videoId) ?? [];
        const topEdge = outgoingEdges[0] ?? null;

        visitOrder.push({
            step: visitOrder.length + 1,
            videoId: current.videoId,
            depth: current.depth,
            fromVideoId: current.fromVideoId,
            predictedNextVideoId: topEdge?.toVideoId ?? null,
            predictedConfidence: topEdge?.confidence ?? null,
            outgoingRecommendationCount: outgoingEdges.length,
        });

        if (current.depth >= options.maxDepth) continue;

        if (options.strategy === 'bfs') {
            for (const edge of outgoingEdges) {
                const seenAtDepth = visitedDepth.get(edge.toVideoId);
                if (seenAtDepth !== undefined) {
                    loopEdges.push({
                        fromVideoId: current.videoId,
                        toVideoId: edge.toVideoId,
                        fromDepth: current.depth,
                        seenAtDepth,
                        confidence: edge.confidence,
                        count: edge.count,
                    });
                    continue;
                }

                if (inFrontier.has(edge.toVideoId)) continue;

                frontier.push({
                    videoId: edge.toVideoId,
                    depth: current.depth + 1,
                    fromVideoId: current.videoId,
                });
                inFrontier.add(edge.toVideoId);
            }
        } else {
            for (let index = outgoingEdges.length - 1; index >= 0; index -= 1) {
                const edge = outgoingEdges[index];
                const seenAtDepth = visitedDepth.get(edge.toVideoId);

                if (seenAtDepth !== undefined) {
                    loopEdges.push({
                        fromVideoId: current.videoId,
                        toVideoId: edge.toVideoId,
                        fromDepth: current.depth,
                        seenAtDepth,
                        confidence: edge.confidence,
                        count: edge.count,
                    });
                    continue;
                }

                if (inFrontier.has(edge.toVideoId)) continue;

                frontier.push({
                    videoId: edge.toVideoId,
                    depth: current.depth + 1,
                    fromVideoId: current.videoId,
                });
                inFrontier.add(edge.toVideoId);
            }
        }
    }

    const visitedVideoIds = new Set(visitOrder.map((step) => step.videoId));
    const nodes: TraversalNode[] = visitOrder.map((step) => {
        const node = graph.nodes.get(step.videoId);
        return {
            videoId: step.videoId,
            title: node?.title ?? null,
            channel: node?.channel ?? null,
            depth: step.depth,
            observations: node?.observations ?? 0,
            outgoingCount: node?.outgoingCount ?? 0,
            incomingCount: node?.incomingCount ?? 0,
        };
    });

    const edges: TraversalEdge[] = [];
    for (const step of visitOrder) {
        const sourceEdges = graph.adjacency.get(step.videoId) ?? [];
        const topTarget = sourceEdges[0]?.toVideoId;

        for (const edge of sourceEdges) {
            const connectsVisitedNodes = visitedVideoIds.has(edge.toVideoId);
            if (!connectsVisitedNodes && edge.toVideoId !== topTarget) continue;

            edges.push({
                fromVideoId: step.videoId,
                toVideoId: edge.toVideoId,
                count: edge.count,
                avgRank: edge.avgRank,
                confidence: edge.confidence,
                title: edge.title,
                channel: edge.channel,
                connectsVisitedNodes,
            });
        }
    }

    const confidenceValues = visitOrder
        .map((step) => step.predictedConfidence)
        .filter((value): value is number => typeof value === 'number');

    const outgoingEdgePool = visitOrder.flatMap((step) => graph.adjacency.get(step.videoId) ?? []);
    const repeatedTransitions = outgoingEdgePool.filter((edge) => edge.count > 1);
    const maxDepthReached = visitOrder.reduce((maxDepth, step) => Math.max(maxDepth, step.depth), 0);

    return {
        strategy: options.strategy,
        seedVideoId,
        platform: options.platform,
        maxDepth: options.maxDepth,
        maxNodes: options.maxNodes,
        summary: {
            totalVisitedVideos: visitOrder.length,
            maxDepthReached,
            loopEdgeCount: loopEdges.length,
            avgPredictionConfidence: confidenceValues.length > 0
                ? roundTo(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
                : 0,
            repeatedTransitionRate: outgoingEdgePool.length > 0
                ? roundTo(repeatedTransitions.length / outgoingEdgePool.length)
                : 0,
        },
        visitOrder,
        nodes,
        edges,
        loopEdges,
    };
}

function buildRecommendationMapFromGraph(
    graph: RecommendationGraph,
    options: RecommendationMapOptions
): RecommendationMapResult {
    const bfs = traverseRecommendationGraph(graph, {
        ...options,
        strategy: 'bfs',
    });

    const dfs = traverseRecommendationGraph(graph, {
        ...options,
        strategy: 'dfs',
    });

    const bfsDepthMap = new Map<string, number>(bfs.visitOrder.map((step) => [step.videoId, step.depth]));
    const dfsDepthMap = new Map<string, number>(dfs.visitOrder.map((step) => [step.videoId, step.depth]));
    const nodeIds = new Set<string>([
        ...bfsDepthMap.keys(),
        ...dfsDepthMap.keys(),
    ]);

    const combinedNodes: CombinedRecommendationNode[] = Array.from(nodeIds)
        .map((videoId) => {
            const bfsDepth = bfsDepthMap.get(videoId) ?? null;
            const dfsDepth = dfsDepthMap.get(videoId) ?? null;
            const node = graph.nodes.get(videoId);

            let discoveredBy: 'bfs' | 'dfs' | 'both' = 'both';
            if (bfsDepth === null) discoveredBy = 'dfs';
            else if (dfsDepth === null) discoveredBy = 'bfs';

            return {
                videoId,
                title: node?.title ?? null,
                channel: node?.channel ?? null,
                bfsDepth,
                dfsDepth,
                discoveredBy,
            };
        })
        .sort((a, b) => {
            const aDepth = Math.min(a.bfsDepth ?? Number.MAX_SAFE_INTEGER, a.dfsDepth ?? Number.MAX_SAFE_INTEGER);
            const bDepth = Math.min(b.bfsDepth ?? Number.MAX_SAFE_INTEGER, b.dfsDepth ?? Number.MAX_SAFE_INTEGER);
            if (aDepth !== bDepth) return aDepth - bDepth;
            return a.videoId.localeCompare(b.videoId);
        });

    const sharedVideos = combinedNodes.filter((node) => node.discoveredBy === 'both').length;
    const bfsUniqueVideos = combinedNodes.filter((node) => node.discoveredBy === 'bfs').length;
    const dfsUniqueVideos = combinedNodes.filter((node) => node.discoveredBy === 'dfs').length;
    const avgPredictionConfidence = roundTo((bfs.summary.avgPredictionConfidence + dfs.summary.avgPredictionConfidence) / 2);
    const totalLoopEdges = bfs.summary.loopEdgeCount + dfs.summary.loopEdgeCount;

    return {
        seedVideoId: options.seedVideoId,
        platform: options.platform,
        maxDepth: options.maxDepth,
        maxNodes: options.maxNodes,
        summary: {
            sharedVideos,
            bfsUniqueVideos,
            dfsUniqueVideos,
            sharedRate: combinedNodes.length > 0 ? roundTo(sharedVideos / combinedNodes.length) : 0,
            avgPredictionConfidence,
            totalLoopEdges,
        },
        bfs,
        dfs,
        combinedNodes,
    };
}

export async function generateRecommendationTraversal(
    userId: string,
    options: RecommendationTraversalOptions
): Promise<RecommendationTraversalResult> {
    const feedItems = await prisma.feedItem.findMany({
        where: {
            snapshot: {
                userId,
                platform: options.platform,
            },
        },
        select: {
            videoId: true,
            creatorHandle: true,
            caption: true,
            engagementMetrics: true,
        },
        take: 6000,
    });

    if (feedItems.length === 0) {
        throw new TraversalInputError(
            `No ${options.platform} feed captures found yet. Capture data first, then retry traversal.`,
            404,
            { platform: options.platform }
        );
    }

    const graph = buildRecommendationGraph(feedItems, options.platform);

    if (graph.nodes.size === 0) {
        throw new TraversalInputError(
            `No valid video graph could be built from your ${options.platform} captures.`,
            404,
            { platform: options.platform }
        );
    }

    return traverseRecommendationGraph(graph, options);
}

function buildRecommendationMapFromFeedItems(
    feedItems: SourceFeedItem[],
    options: RecommendationMapOptions
): RecommendationMapResult {
    if (feedItems.length === 0) {
        throw new TraversalInputError(
            `No ${options.platform} feed captures found yet. Capture data first, then retry traversal.`,
            404,
            { platform: options.platform }
        );
    }

    const graph = buildRecommendationGraph(feedItems, options.platform);

    if (graph.nodes.size === 0) {
        throw new TraversalInputError(
            `No valid video graph could be built from your ${options.platform} captures.`,
            404,
            { platform: options.platform }
        );
    }

    return buildRecommendationMapFromGraph(graph, options);
}

export async function generateRecommendationMap(
    userId: string,
    options: RecommendationMapOptions
): Promise<RecommendationMapResult> {
    const feedItems = await prisma.feedItem.findMany({
        where: {
            snapshot: {
                userId,
                platform: options.platform,
            },
        },
        select: {
            videoId: true,
            creatorHandle: true,
            caption: true,
            engagementMetrics: true,
        },
        take: 6000,
    });

    const map = buildRecommendationMapFromFeedItems(feedItems, options);
    map.scope = {
        type: 'personal',
        userCount: 1,
    };

    return map;
}

export async function generateRecommendationMapForUsers(
    userIds: string[],
    options: RecommendationMapOptions,
    scope?: { cohortId?: string }
): Promise<RecommendationMapResult> {
    const uniqueUserIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)));
    if (uniqueUserIds.length === 0) {
        throw new TraversalInputError('No users available for this recommendation map scope.', 404);
    }

    const feedItems = await prisma.feedItem.findMany({
        where: {
            snapshot: {
                platform: options.platform,
                userId: { in: uniqueUserIds },
            },
        },
        select: {
            videoId: true,
            creatorHandle: true,
            caption: true,
            engagementMetrics: true,
        },
        take: 12000,
    });

    const map = buildRecommendationMapFromFeedItems(feedItems, options);
    map.scope = {
        type: scope?.cohortId ? 'cohort' : 'personal',
        userCount: uniqueUserIds.length,
        cohortId: scope?.cohortId,
    };

    return map;
}
