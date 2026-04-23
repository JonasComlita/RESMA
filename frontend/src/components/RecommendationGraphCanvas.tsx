import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, WheelEvent } from 'react';
import type { RecommendationMapResult } from '../types/recommendationMap';

interface RecommendationGraphCanvasProps {
    map: RecommendationMapResult;
}

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

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 700;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.8;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function shortenVideoId(videoId: string) {
    return videoId.length > 10 ? `${videoId.slice(0, 8)}...` : videoId;
}

function mergeEdges(map: RecommendationMapResult): MergedEdge[] {
    const edges = new Map<string, MergedEdge>();

    const absorb = (fromVideoId: string, toVideoId: string, isBfs: boolean, isDfs: boolean, confidence: number) => {
        const key = `${fromVideoId}::${toVideoId}`;
        const current = edges.get(key);
        if (!current) {
            edges.set(key, {
                fromVideoId,
                toVideoId,
                bfs: isBfs,
                dfs: isDfs,
                confidence,
            });
            return;
        }

        current.bfs = current.bfs || isBfs;
        current.dfs = current.dfs || isDfs;
        current.confidence = Math.max(current.confidence, confidence);
    };

    for (const edge of map.bfs.edges) {
        absorb(edge.fromVideoId, edge.toVideoId, true, false, edge.confidence);
    }

    for (const edge of map.dfs.edges) {
        absorb(edge.fromVideoId, edge.toVideoId, false, true, edge.confidence);
    }

    return Array.from(edges.values());
}

function edgeColor(edge: MergedEdge) {
    if (edge.bfs && edge.dfs) return '#0f766e';
    if (edge.bfs) return '#2563eb';
    return '#ea580c';
}

function nodeColor(type: 'bfs' | 'dfs' | 'both') {
    if (type === 'both') return '#0f766e';
    if (type === 'bfs') return '#2563eb';
    return '#ea580c';
}

export function RecommendationGraphCanvas({ map }: RecommendationGraphCanvasProps) {
    const allEdges = useMemo(() => mergeEdges(map), [map]);
    const depthMap = useMemo(() => {
        const depths = new Map<string, number>();
        for (const node of map.combinedNodes) {
            const firstDepth = Math.min(
                node.bfsDepth ?? Number.MAX_SAFE_INTEGER,
                node.dfsDepth ?? Number.MAX_SAFE_INTEGER
            );
            depths.set(node.videoId, firstDepth === Number.MAX_SAFE_INTEGER ? 0 : firstDepth);
        }
        return depths;
    }, [map.combinedNodes]);

    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([map.seedVideoId]));
    const [selectedNodeId, setSelectedNodeId] = useState<string>(map.seedVideoId);
    const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
    const [nodePositions, setNodePositions] = useState<Map<string, NodePosition>>(new Map());

    const svgRef = useRef<SVGSVGElement | null>(null);
    const layoutRequestIdRef = useRef(0);

    useEffect(() => {
        setExpandedNodes(new Set([map.seedVideoId]));
        setSelectedNodeId(map.seedVideoId);
        setViewport({ x: 0, y: 0, scale: 1 });
    }, [map.seedVideoId]);

    const visibleNodeIds = useMemo(() => {
        const visible = new Set<string>([map.seedVideoId]);

        for (const nodeId of expandedNodes) {
            visible.add(nodeId);
            for (const edge of allEdges) {
                if (edge.fromVideoId === nodeId) {
                    visible.add(edge.toVideoId);
                }
            }
        }

        visible.add(selectedNodeId);

        return visible;
    }, [allEdges, expandedNodes, map.seedVideoId, selectedNodeId]);

    const visibleNodes = useMemo(
        () => map.combinedNodes.filter((node) => visibleNodeIds.has(node.videoId)),
        [map.combinedNodes, visibleNodeIds]
    );

    const visibleEdges = useMemo(
        () => allEdges.filter(
            (edge) => visibleNodeIds.has(edge.fromVideoId) && visibleNodeIds.has(edge.toVideoId)
        ),
        [allEdges, visibleNodeIds]
    );

    useEffect(() => {
        if (visibleNodes.length === 0) {
            setNodePositions(new Map());
            return;
        }

        const worker = new Worker(
            new URL('./recommendationGraphLayoutWorker.ts', import.meta.url),
            { type: 'module' }
        );
        const requestId = layoutRequestIdRef.current + 1;
        layoutRequestIdRef.current = requestId;

        worker.onmessage = (
            event: MessageEvent<{
                requestId: number;
                positions: Array<{ videoId: string; x: number; y: number }>;
            }>
        ) => {
            if (event.data.requestId !== layoutRequestIdRef.current) {
                return;
            }

            setNodePositions(new Map(
                event.data.positions.map((position) => [
                    position.videoId,
                    { x: position.x, y: position.y },
                ])
            ));
            worker.terminate();
        };

        worker.postMessage({
            requestId,
            nodeIds: visibleNodes.map((node) => node.videoId),
            edges: visibleEdges,
            nodeDepthEntries: Array.from(depthMap.entries()),
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
        });

        return () => {
            worker.terminate();
        };
    }, [depthMap, visibleEdges, visibleNodes]);

    const selectedNode = useMemo(
        () => map.combinedNodes.find((node) => node.videoId === selectedNodeId) || null,
        [map.combinedNodes, selectedNodeId]
    );

    const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
        event.preventDefault();

        const svg = svgRef.current;
        if (!svg) return;

        const rect = svg.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const zoomFactor = event.deltaY < 0 ? 1.12 : 0.9;

        setViewport((current) => {
            const nextScale = clamp(current.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
            const worldX = (pointerX - current.x) / current.scale;
            const worldY = (pointerY - current.y) / current.scale;

            return {
                scale: nextScale,
                x: pointerX - worldX * nextScale,
                y: pointerY - worldY * nextScale,
            };
        });
    };

    const handleMouseDown = (event: MouseEvent<SVGSVGElement>) => {
        setIsPanning(true);
        setPanStart({
            x: event.clientX - viewport.x,
            y: event.clientY - viewport.y,
        });
    };

    const handleMouseMove = (event: MouseEvent<SVGSVGElement>) => {
        if (!isPanning || !panStart) return;
        setViewport((current) => ({
            ...current,
            x: event.clientX - panStart.x,
            y: event.clientY - panStart.y,
        }));
    };

    const endPanning = () => {
        setIsPanning(false);
        setPanStart(null);
    };

    const toggleNodeExpansion = (videoId: string) => {
        setSelectedNodeId(videoId);
        setExpandedNodes((current) => {
            const next = new Set(current);
            if (next.has(videoId) && videoId !== map.seedVideoId) {
                next.delete(videoId);
            } else {
                next.add(videoId);
            }
            return next;
        });
    };

    return (
        <div className="rounded-2xl border border-gray-200 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-slate-200">
                <div className="text-xs font-medium">
                    Graph Canvas: click nodes to expand/collapse neighbors, drag to pan, wheel to zoom.
                </div>
                <div className="flex gap-2 text-xs">
                    <button
                        type="button"
                        onClick={() => {
                            setViewport({ x: 0, y: 0, scale: 1 });
                        }}
                        className="rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800"
                    >
                        Reset View
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setExpandedNodes(new Set(map.combinedNodes.map((node) => node.videoId)));
                        }}
                        className="rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800"
                    >
                        Expand All
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setExpandedNodes(new Set([map.seedVideoId]));
                            setSelectedNodeId(map.seedVideoId);
                        }}
                        className="rounded-md border border-slate-700 px-2 py-1 hover:bg-slate-800"
                    >
                        Focus Seed
                    </button>
                </div>
            </div>

            <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                className={`h-[540px] w-full cursor-${isPanning ? 'grabbing' : 'grab'} rounded-xl bg-slate-900`}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={endPanning}
                onMouseLeave={endPanning}
            >
                <defs>
                    <pattern id="grid-pattern" width="32" height="32" patternUnits="userSpaceOnUse">
                        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e293b" strokeWidth="1" />
                    </pattern>
                </defs>

                <rect x={0} y={0} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="url(#grid-pattern)" />

                <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}>
                    {visibleEdges.map((edge) => {
                        const source = nodePositions.get(edge.fromVideoId);
                        const target = nodePositions.get(edge.toVideoId);
                        if (!source || !target) return null;

                        return (
                            <line
                                key={`${edge.fromVideoId}-${edge.toVideoId}`}
                                x1={source.x}
                                y1={source.y}
                                x2={target.x}
                                y2={target.y}
                                stroke={edgeColor(edge)}
                                strokeOpacity={0.32 + edge.confidence * 0.35}
                                strokeWidth={1.2 + edge.confidence * 2}
                            />
                        );
                    })}

                    {visibleNodes.map((node) => {
                        const position = nodePositions.get(node.videoId);
                        if (!position) return null;

                        const isSelected = selectedNodeId === node.videoId;
                        const isExpanded = expandedNodes.has(node.videoId);
                        const radius = isSelected ? 15 : isExpanded ? 12 : 10;
                        const fill = nodeColor(node.discoveredBy);

                        return (
                            <g
                                key={node.videoId}
                                transform={`translate(${position.x}, ${position.y})`}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    toggleNodeExpansion(node.videoId);
                                }}
                                className="cursor-pointer"
                            >
                                <circle
                                    r={radius + 4}
                                    fill={fill}
                                    opacity={0.16}
                                />
                                <circle
                                    r={radius}
                                    fill={fill}
                                    stroke={isSelected ? '#e2e8f0' : '#020617'}
                                    strokeWidth={isSelected ? 2.6 : 1.4}
                                />
                                <text
                                    x={0}
                                    y={4}
                                    textAnchor="middle"
                                    className="fill-slate-50 text-[10px] font-semibold"
                                >
                                    {shortenVideoId(node.videoId)}
                                </text>
                            </g>
                        );
                    })}
                </g>
            </svg>

            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-200 md:grid-cols-3">
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-2">
                    <div className="font-semibold">Legend</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                        <span className="rounded bg-teal-800 px-2 py-0.5">Node discovered by both</span>
                        <span className="rounded bg-blue-800 px-2 py-0.5">BFS-only node</span>
                        <span className="rounded bg-orange-800 px-2 py-0.5">DFS-only node</span>
                    </div>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-2">
                    <div className="font-semibold">Edges</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                        <span className="rounded bg-teal-900 px-2 py-0.5">Shared transition</span>
                        <span className="rounded bg-blue-900 px-2 py-0.5">BFS transition</span>
                        <span className="rounded bg-orange-900 px-2 py-0.5">DFS transition</span>
                    </div>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-2">
                    <div className="font-semibold">Selected Node</div>
                    {selectedNode ? (
                        <div className="mt-1 space-y-0.5">
                            <div className="truncate">
                                <span className="text-slate-400">Video:</span> {selectedNode.videoId}
                            </div>
                            <div>
                                <span className="text-slate-400">BFS depth:</span> {selectedNode.bfsDepth ?? '-'}
                            </div>
                            <div>
                                <span className="text-slate-400">DFS depth:</span> {selectedNode.dfsDepth ?? '-'}
                            </div>
                        </div>
                    ) : (
                        <div className="mt-1 text-slate-400">Select a node to inspect details.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
