/// <reference lib="webworker" />

import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    type SimulationLinkDatum,
    type SimulationNodeDatum,
} from 'd3-force';

interface MergedEdge {
    fromVideoId: string;
    toVideoId: string;
    bfs: boolean;
    dfs: boolean;
    confidence: number;
}

interface NodePosition {
    x: number;
    y: number;
}

interface LayoutNode extends SimulationNodeDatum {
    id: string;
    depth: number;
    x: number;
    y: number;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
    source: string | LayoutNode;
    target: string | LayoutNode;
    confidence: number;
}

interface LayoutRequest {
    requestId: number;
    nodeIds: string[];
    edges: MergedEdge[];
    nodeDepthEntries: Array<[string, number]>;
    width: number;
    height: number;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
}

function seedNodePosition(videoId: string, depth: number, width: number, height: number): NodePosition {
    const seed = hashString(videoId);
    const angle = ((seed % 360) * Math.PI) / 180;
    const radialBase = Math.min(width, height) * 0.13;
    const depthOffset = depth * (Math.min(width, height) * 0.09);
    const radius = radialBase + depthOffset + (seed % 37);

    return {
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
    };
}

function computeLayout(
    nodeIds: string[],
    edges: MergedEdge[],
    nodeDepths: Map<string, number>,
    width: number,
    height: number
) {
    if (nodeIds.length === 0) {
        return [];
    }

    const nodes: LayoutNode[] = nodeIds.map((videoId) => {
        const depth = nodeDepths.get(videoId) ?? 0;
        const position = seedNodePosition(videoId, depth, width, height);

        return {
            id: videoId,
            depth,
            x: position.x,
            y: position.y,
        };
    });

    const visibleNodeIds = new Set(nodeIds);
    const links: LayoutLink[] = edges
        .filter((edge) => visibleNodeIds.has(edge.fromVideoId) && visibleNodeIds.has(edge.toVideoId))
        .map((edge) => ({
            source: edge.fromVideoId,
            target: edge.toVideoId,
            confidence: edge.confidence,
        }));

    const simulation = forceSimulation<LayoutNode>(nodes)
        .force('charge', forceManyBody<LayoutNode>().strength((node) => -230 - node.depth * 28))
        .force('link', forceLink<LayoutNode, LayoutLink>(links)
            .id((node) => node.id)
            .distance((link) => {
                const sourceDepth = typeof link.source === 'string' ? nodeDepths.get(link.source) ?? 0 : link.source.depth;
                const targetDepth = typeof link.target === 'string' ? nodeDepths.get(link.target) ?? 0 : link.target.depth;
                const shallowestDepth = Math.min(sourceDepth, targetDepth);
                const depthGap = Math.abs(sourceDepth - targetDepth);
                return 58 + shallowestDepth * 32 + depthGap * 20 - link.confidence * 12;
            })
            .strength((link) => 0.38 + link.confidence * 0.34))
        .force('center', forceCenter<LayoutNode>(width / 2, height / 2).strength(0.18))
        .force('collide', forceCollide<LayoutNode>().radius((node) => 24 + node.depth * 2).strength(0.85))
        .stop();

    simulation.tick(300);

    return nodes.map((node) => ({
        videoId: node.id,
        x: clamp(node.x, 50, width - 50),
        y: clamp(node.y, 50, height - 50),
    }));
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
    const {
        requestId,
        nodeIds,
        edges,
        nodeDepthEntries,
        width,
        height,
    } = event.data;

    const positions = computeLayout(
        nodeIds,
        edges,
        new Map(nodeDepthEntries),
        width,
        height
    );

    self.postMessage({
        requestId,
        positions,
    });
};
