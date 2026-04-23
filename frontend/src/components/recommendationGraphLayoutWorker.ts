/// <reference lib="webworker" />

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

    const area = width * height;
    const k = Math.sqrt(area / nodeIds.length);
    const positions = new Map<string, NodePosition>();

    for (let index = 0; index < nodeIds.length; index += 1) {
        const videoId = nodeIds[index];
        const seed = hashString(videoId);
        const depth = nodeDepths.get(videoId) ?? 0;
        const angle = ((seed % 360) * Math.PI) / 180;
        const radialBase = Math.min(width, height) * 0.13;
        const depthOffset = depth * (Math.min(width, height) * 0.09);
        const radius = radialBase + depthOffset + (seed % 37);

        positions.set(videoId, {
            x: width / 2 + Math.cos(angle) * radius,
            y: height / 2 + Math.sin(angle) * radius,
        });
    }

    const iterations = nodeIds.length > 140 ? 120 : 180;
    const temperatureStart = Math.min(width, height) * 0.12;

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const displacements = new Map<string, { dx: number; dy: number }>();
        for (const videoId of nodeIds) {
            displacements.set(videoId, { dx: 0, dy: 0 });
        }

        for (let i = 0; i < nodeIds.length; i += 1) {
            const aId = nodeIds[i];
            const a = positions.get(aId)!;
            for (let j = i + 1; j < nodeIds.length; j += 1) {
                const bId = nodeIds[j];
                const b = positions.get(bId)!;

                let dx = a.x - b.x;
                let dy = a.y - b.y;
                const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const repulsive = (k * k) / distance;
                dx = (dx / distance) * repulsive;
                dy = (dy / distance) * repulsive;

                const dispA = displacements.get(aId)!;
                const dispB = displacements.get(bId)!;
                dispA.dx += dx;
                dispA.dy += dy;
                dispB.dx -= dx;
                dispB.dy -= dy;
            }
        }

        for (const edge of edges) {
            const source = positions.get(edge.fromVideoId);
            const target = positions.get(edge.toVideoId);
            if (!source || !target) continue;

            let dx = source.x - target.x;
            let dy = source.y - target.y;
            const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const attractive = (distance * distance) / k;
            dx = (dx / distance) * attractive;
            dy = (dy / distance) * attractive;

            const sourceDisp = displacements.get(edge.fromVideoId)!;
            const targetDisp = displacements.get(edge.toVideoId)!;
            sourceDisp.dx -= dx;
            sourceDisp.dy -= dy;
            targetDisp.dx += dx;
            targetDisp.dy += dy;
        }

        const temperature = temperatureStart * (1 - iteration / iterations);
        for (const videoId of nodeIds) {
            const position = positions.get(videoId)!;
            const disp = displacements.get(videoId)!;
            const displacementLength = Math.max(1, Math.sqrt(disp.dx * disp.dx + disp.dy * disp.dy));
            const limitedDx = (disp.dx / displacementLength) * Math.min(temperature, displacementLength);
            const limitedDy = (disp.dy / displacementLength) * Math.min(temperature, displacementLength);

            position.x = clamp(position.x + limitedDx, 50, width - 50);
            position.y = clamp(position.y + limitedDy, 50, height - 50);
        }
    }

    return nodeIds
        .map((videoId) => {
            const position = positions.get(videoId);
            return position ? { videoId, x: position.x, y: position.y } : null;
        })
        .filter((entry): entry is { videoId: string; x: number; y: number } => Boolean(entry));
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
