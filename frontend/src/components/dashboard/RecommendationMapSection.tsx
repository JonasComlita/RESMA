import { ErrorBoundary } from '../ErrorBoundary';
import { RecommendationGraphCanvas } from '../RecommendationGraphCanvas';
import { Download, Loader2, Network } from 'lucide-react';
import type {
    RecommendationMapResult,
    TraversalSummary,
    TraversalVisitStep,
} from '../../types/recommendationMap';
import { exportGexf } from '../../utils/exportGexf';

interface RecommendationMapSectionProps {
    platform: string;
    setPlatform: (value: string) => void;
    maxDepth: number;
    setMaxDepth: (value: number) => void;
    seedVideoId: string;
    setSeedVideoId: (value: string) => void;
    maxNodes: number;
    setMaxNodes: (value: number) => void;
    mapResult: RecommendationMapResult | null;
    mapError: string | null;
    isMapLoading: boolean;
    selectedCohortId: string | null;
    selectedCohortLabel: string | null;
    onLoadRecommendationMap: (input: {
        seed: string;
        cohortId?: string;
        cohortLabel?: string;
    }) => void;
    onResetToContributorScope: () => void;
}

export function RecommendationMapSection({
    platform,
    setPlatform,
    maxDepth,
    setMaxDepth,
    seedVideoId,
    setSeedVideoId,
    maxNodes,
    setMaxNodes,
    mapResult,
    mapError,
    isMapLoading,
    selectedCohortId,
    selectedCohortLabel,
    onLoadRecommendationMap,
    onResetToContributorScope,
}: RecommendationMapSectionProps) {
    const handleGexfDownload = () => {
        if (!mapResult) return;

        const gexfString = exportGexf(mapResult);
        const objectUrl = URL.createObjectURL(new Blob([gexfString], { type: 'application/gexf+xml' }));
        const anchor = document.createElement('a');
        const safeSeed = mapResult.seedVideoId.replace(/[^a-zA-Z0-9_-]/g, '-');
        const safePlatform = mapResult.platform.replace(/[^a-zA-Z0-9_-]/g, '-');

        anchor.href = objectUrl;
        anchor.download = `resma-recommendation-map-${safeSeed}-${safePlatform}.gexf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
    };

    return (
        <ErrorBoundary
            title="The recommendation observatory map failed to render."
            description="You can still use the contributor and aggregate insight controls while this panel is reset."
            resetKey={`${platform}:${seedVideoId}:${selectedCohortId ?? 'contributor'}:${mapResult?.summary.sharedVideos ?? 0}`}
        >
            <div className="bg-white p-6 rounded-2xl shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <Network className="w-5 h-5 text-blue-600" />
                            Recommendation Observatory Map
                        </h2>
                        <p className="text-sm text-gray-600 mt-1">
                            Explore where recommendations converge or diverge across your contributor feed and selected aggregate cohorts.
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                            Scope: {selectedCohortId
                                ? `Cohort (${selectedCohortLabel || selectedCohortId})`
                                : 'Your contributor feed'}
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                        {selectedCohortId && (
                            <button
                                type="button"
                                className="self-start rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 md:self-auto"
                                onClick={onResetToContributorScope}
                            >
                                Use Contributor Scope
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleGexfDownload}
                            disabled={!mapResult}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Export GEXF
                        </button>
                        <p className="max-w-xs text-xs text-gray-500 md:text-right">
                            Opens in Gephi desktop or Gephi Lite for community detection and advanced layout.
                        </p>
                    </div>
                </div>

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        onLoadRecommendationMap({
                            seed: seedVideoId,
                            cohortId: selectedCohortId ?? undefined,
                            cohortLabel: selectedCohortLabel ?? undefined,
                        });
                    }}
                    className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6"
                >
                    <input
                        type="text"
                        value={seedVideoId}
                        onChange={(event) => setSeedVideoId(event.target.value)}
                        placeholder="Seed video ID (for example: dQw4w9WgXcQ)"
                        className="md:col-span-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <select
                        value={platform}
                        onChange={(event) => setPlatform(event.target.value)}
                        className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="youtube">YouTube</option>
                        <option value="instagram">Instagram</option>
                        <option value="twitter">Twitter</option>
                        <option value="tiktok">TikTok</option>
                    </select>
                    <input
                        type="number"
                        min={1}
                        max={8}
                        value={maxDepth}
                        onChange={(event) => setMaxDepth(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
                        className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        title="Max depth"
                    />
                    <div className="flex gap-2">
                        <input
                            type="number"
                            min={10}
                            max={300}
                            value={maxNodes}
                            onChange={(event) => setMaxNodes(Math.min(300, Math.max(10, Number(event.target.value) || 10)))}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            title="Max nodes"
                        />
                        <button
                            type="submit"
                            disabled={isMapLoading}
                            className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isMapLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Map'}
                        </button>
                    </div>
                </form>

                {mapError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {mapError}
                    </div>
                )}

                {mapResult && (
                    <div className="space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                            <MapMetric title="Shared Videos" value={mapResult.summary.sharedVideos} />
                            <MapMetric title="BFS-Only" value={mapResult.summary.bfsUniqueVideos} />
                            <MapMetric title="DFS-Only" value={mapResult.summary.dfsUniqueVideos} />
                            <MapMetric title="Shared Rate" value={`${Math.round(mapResult.summary.sharedRate * 100)}%`} />
                            <MapMetric title="Avg Confidence" value={`${Math.round(mapResult.summary.avgPredictionConfidence * 100)}%`} />
                        </div>

                        <RecommendationGraphCanvas map={mapResult} />

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <TraversalLane
                                title="BFS Signal"
                                summary={mapResult.bfs.summary}
                                steps={mapResult.bfs.visitOrder}
                            />
                            <TraversalLane
                                title="DFS Signal"
                                summary={mapResult.dfs.summary}
                                steps={mapResult.dfs.visitOrder}
                            />
                        </div>
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
}

function MapMetric({ title, value }: { title: string; value: number | string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
        </div>
    );
}

function TraversalLane({
    title,
    summary,
    steps,
}: {
    title: string;
    summary: TraversalSummary;
    steps: TraversalVisitStep[];
}) {
    return (
        <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
            <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
            <p className="text-xs text-gray-500 mb-3">
                Visited {summary.totalVisitedVideos} videos | loops {summary.loopEdgeCount} | depth {summary.maxDepthReached}
            </p>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {steps.map((step) => (
                    <div key={`${title}-${step.step}-${step.videoId}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-gray-500">#{step.step}</span>
                            <span className="text-xs text-gray-500">depth {step.depth}</span>
                        </div>
                        <code className="block mt-1 text-xs text-gray-900 break-all">{step.videoId}</code>
                        <p className="mt-1 text-[11px] text-gray-500">
                            Predicts next: {step.predictedNextVideoId ?? 'none'} ({Math.round((step.predictedConfidence ?? 0) * 100)}%)
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
