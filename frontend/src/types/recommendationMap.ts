export interface TraversalVisitStep {
    step: number;
    videoId: string;
    depth: number;
    fromVideoId: string | null;
    predictedNextVideoId: string | null;
    predictedConfidence: number | null;
    outgoingRecommendationCount: number;
}

export interface TraversalSummary {
    totalVisitedVideos: number;
    maxDepthReached: number;
    loopEdgeCount: number;
    avgPredictionConfidence: number;
    repeatedTransitionRate: number;
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

export interface TraversalResult {
    strategy: 'bfs' | 'dfs';
    summary: TraversalSummary;
    visitOrder: TraversalVisitStep[];
    edges: TraversalEdge[];
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
    bfs: TraversalResult;
    dfs: TraversalResult;
    combinedNodes: CombinedRecommendationNode[];
}
