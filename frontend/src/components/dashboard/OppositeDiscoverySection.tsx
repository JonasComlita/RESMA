import { AlertTriangle, Compass, Loader2, RefreshCw, Shuffle } from 'lucide-react';
import { ErrorBoundary } from '../ErrorBoundary';
import type {
    OppositeDiscoveryBridgeContent,
    OppositeDiscoveryCandidate,
    OppositeDiscoveryCohort,
    OppositeDiscoveryResult,
} from '../../types/oppositeDiscovery';

interface OppositeDiscoverySectionProps {
    platform: string;
    result: OppositeDiscoveryResult | null;
    error: string | null;
    isLoading: boolean;
    onRefresh: () => void;
}

export function OppositeDiscoverySection({
    platform,
    result,
    error,
    isLoading,
    onRefresh,
}: OppositeDiscoverySectionProps) {
    return (
        <ErrorBoundary
            title="The opposite-spectrum discovery panel failed to render."
            description="The rest of the observatory is still available while this section resets."
            resetKey={`${platform}:${result?.bubble.score ?? 0}:${result?.candidates.length ?? 0}`}
        >
            <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Outside Your Bubble</p>
                        <h2 className="mt-2 flex items-center gap-2 text-xl font-bold text-gray-900">
                            <Compass className="h-5 w-5 text-amber-600" />
                            Opposite-Spectrum Discovery
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                            Aggregate-only discovery for content that is common in distant cohorts, rare in your current cohort, and sometimes reachable from what you already watch.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={isLoading}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                {result?.qualityGate.status === 'degraded' && (
                    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
                            <div>
                                <p className="text-sm font-semibold text-amber-900">Discovery confidence is currently degraded</p>
                                <p className="mt-1 text-sm text-amber-800">
                                    Results are still available, but observatory quality gates are below target. Treat candidate rankings as directional rather than strong evidence.
                                </p>
                                <ul className="mt-3 space-y-2 text-sm text-amber-900">
                                    {result.qualityGate.degradationReasons.map((reason) => (
                                        <li key={reason} className="rounded-lg border border-amber-100 bg-white/70 px-3 py-2">
                                            {reason}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {result && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <MetricCard title="Bubble Score" value={`${Math.round(result.bubble.score * 100)}%`} detail={result.bubble.level} />
                            <MetricCard title="Dominant Category" value={result.bubble.dominantCategory} detail={`${Math.round(result.bubble.topCategoryShare * 100)}% share`} />
                            <MetricCard title="Outside-Cohort Candidates" value={result.diversityGap.outsideCurrentCohortCandidateCount} detail={`${result.diversityGap.distantCohortCount} distant cohorts`} />
                            <MetricCard title="Bridge Content" value={result.diversityGap.bridgeCandidateCount} detail={`${result.currentCohort.cohortLabel}${result.currentCohort.materialized ? '' : ' (temporary profile)'}`} />
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <p className="text-sm font-semibold text-gray-900">Why your current bubble looks this way</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Pill label={`Diversity: ${result.bubble.diversityBand}`} />
                                <Pill label={`Loyalty: ${result.bubble.loyaltyBand}`} />
                                <Pill label={`Top creator share: ${Math.round(result.bubble.topCreatorShare * 100)}%`} />
                                <Pill label={`Dominant category share: ${Math.round(result.bubble.topCategoryShare * 100)}%`} />
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-gray-700">
                                {result.bubble.explanations.map((explanation) => (
                                    <li key={explanation} className="rounded-lg bg-white px-3 py-2">
                                        {explanation}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                                <h3 className="font-semibold text-gray-900">Distant Cohorts</h3>
                                <p className="mt-1 text-xs text-gray-500">
                                    Ranked by category mismatch, low overlap, and different transition patterns.
                                </p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="border-b border-gray-100 bg-white">
                                        <tr className="text-left text-gray-600">
                                            <th className="px-4 py-3 font-semibold">Cohort</th>
                                            <th className="px-4 py-3 font-semibold">Users</th>
                                            <th className="px-4 py-3 font-semibold">Distance</th>
                                            <th className="px-4 py-3 font-semibold">Video Overlap</th>
                                            <th className="px-4 py-3 font-semibold">Transition Overlap</th>
                                            <th className="px-4 py-3 font-semibold">Why Far</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.oppositeCohorts.map((cohort) => (
                                            <CohortRow key={cohort.cohortId} cohort={cohort} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <CandidateList candidates={result.candidates} />
                            <BridgeList bridgeContent={result.bridgeContent} />
                        </div>
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
}

function MetricCard({ title, value, detail }: { title: string; value: number | string; detail: string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
            <p className="mt-1 text-xs text-gray-500">{detail}</p>
        </div>
    );
}

function Pill({ label }: { label: string }) {
    return (
        <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
            {label}
        </span>
    );
}

function CohortRow({ cohort }: { cohort: OppositeDiscoveryCohort }) {
    return (
        <tr className="border-b border-gray-100 last:border-0">
            <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{cohort.cohortLabel}</div>
                <div className="text-xs text-gray-500">{cohort.cohortId}</div>
            </td>
            <td className="px-4 py-3 text-gray-700">{cohort.users.toLocaleString()}</td>
            <td className="px-4 py-3 text-gray-700">{Math.round(cohort.distanceScore * 100)}%</td>
            <td className="px-4 py-3 text-gray-700">{Math.round(cohort.videoOverlap * 100)}%</td>
            <td className="px-4 py-3 text-gray-700">{Math.round(cohort.transitionOverlap * 100)}%</td>
            <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                    {cohort.whyFar.map((reason) => (
                        <Pill key={`${cohort.cohortId}-${reason}`} label={reason} />
                    ))}
                </div>
            </td>
        </tr>
    );
}

function CandidateList({ candidates }: { candidates: OppositeDiscoveryCandidate[] }) {
    return (
        <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                <Shuffle className="h-4 w-4 text-amber-600" />
                Underexposed Candidates
            </h3>
            <p className="mt-1 text-xs text-gray-500">
                Common in distant cohorts, rare in your current cohort, and not yet seen in your observed history.
            </p>
            <div className="mt-4 space-y-3">
                {candidates.length === 0 && (
                    <div className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600">
                        No outside-cohort candidates cleared the current quality and distance thresholds yet.
                    </div>
                )}
                {candidates.map((candidate) => (
                    <div key={`${candidate.sourceCohortId}-${candidate.videoId}`} className="rounded-xl bg-gray-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <code className="text-sm font-semibold text-gray-900">{candidate.videoId}</code>
                                <p className="mt-1 text-xs text-gray-500">{candidate.sourceCohortLabel}</p>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-700">
                                {Math.round(candidate.score * 100)} score
                            </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
                            <Pill label={`Cohort exposure ${Math.round(candidate.cohortExposureRate * 100)}%`} />
                            <Pill label={`Current cohort ${Math.round(candidate.currentCohortExposureRate * 100)}%`} />
                            <Pill label={`Lift +${Math.round(candidate.underexposureLift * 100)} pts`} />
                        </div>
                        <ul className="mt-3 space-y-2 text-sm text-gray-700">
                            {candidate.explanations.map((explanation) => (
                                <li key={`${candidate.videoId}-${explanation}`}>{explanation}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BridgeList({ bridgeContent }: { bridgeContent: OppositeDiscoveryBridgeContent[] }) {
    return (
        <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                <Compass className="h-4 w-4 text-blue-600" />
                Bridge Content
            </h3>
            <p className="mt-1 text-xs text-gray-500">
                Items that are common elsewhere but still connect to paths already present in your observed recommendation graph.
            </p>
            <div className="mt-4 space-y-3">
                {bridgeContent.length === 0 && (
                    <div className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600">
                        No bridge items were reachable within the current depth and beam limits.
                    </div>
                )}
                {bridgeContent.map((bridge) => (
                    <div key={`${bridge.sourceCohortId}-${bridge.videoId}`} className="rounded-xl bg-gray-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <code className="text-sm font-semibold text-gray-900">{bridge.videoId}</code>
                                <p className="mt-1 text-xs text-gray-500">{bridge.sourceCohortLabel}</p>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-700">
                                {Math.round(bridge.pathReachProbability * 100)}% path
                            </span>
                        </div>
                        <p className="mt-3 text-sm text-gray-700">{bridge.label}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {bridge.pathSeeds.map((seed) => (
                                <Pill key={`${bridge.videoId}-${seed}`} label={`Seed ${seed}`} />
                            ))}
                        </div>
                        <p className="mt-3 text-xs text-gray-500">
                            Best path: {bridge.bestPath.join(' -> ')}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}
