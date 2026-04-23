import { ErrorBoundary } from '../ErrorBoundary';
import { Loader2, Sigma, Target } from 'lucide-react';
import type { AudienceForecastResult, CohortAudienceForecast } from '../../types/audienceForecast';
import type { ForecastEvaluationResult } from '../../types/forecastEvaluation';

interface ForecastSectionProps {
    platform: string;
    targetVideoId: string;
    setTargetVideoId: (value: string) => void;
    forecastSeedVideoId: string;
    setForecastSeedVideoId: (value: string) => void;
    beamWidth: number;
    setBeamWidth: (value: number) => void;
    forecast: AudienceForecastResult | null;
    forecastError: string | null;
    isForecastLoading: boolean;
    evaluation: ForecastEvaluationResult | null;
    isEvaluationLoading: boolean;
    isBriefExporting: boolean;
    briefExportMessage: string | null;
    onSubmitForecast: () => void;
    onExportBrief: () => void;
    onViewCohortMap: (cohort: CohortAudienceForecast) => void;
}

export function ForecastSection({
    platform,
    targetVideoId,
    setTargetVideoId,
    forecastSeedVideoId,
    setForecastSeedVideoId,
    beamWidth,
    setBeamWidth,
    forecast,
    forecastError,
    isForecastLoading,
    evaluation,
    isEvaluationLoading,
    isBriefExporting,
    briefExportMessage,
    onSubmitForecast,
    onExportBrief,
    onViewCohortMap,
}: ForecastSectionProps) {
    return (
        <>
            <div className="mt-8 mb-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Aggregate Insight Studio</p>
                <p className="text-sm text-gray-600 mt-1">
                    Forecasts, cohort rankings, and briefs below are generated from aggregate observatory cohorts rather than raw contributor-level drilldowns.
                </p>
            </div>

            <ErrorBoundary
                title="The aggregate reach forecast panel failed to render."
                description="Forecast calculations are still available after retrying this panel, and the rest of the observatory remains intact."
                resetKey={`${platform}:${targetVideoId}:${forecastSeedVideoId}:${forecast?.targetVideoId ?? 'none'}`}
            >
                <div className="bg-white p-6 rounded-2xl shadow-sm mt-8">
                    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Target className="w-5 h-5 text-emerald-600" />
                                Aggregate Reach Forecast
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                                Predicts which aggregate cohorts a target video is most likely to reach using cross-user comparisons.
                                Model quality increases as more contributors compare feeds.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 md:items-end">
                            <button
                                type="button"
                                onClick={onExportBrief}
                                disabled={isBriefExporting}
                                className="inline-flex items-center justify-center rounded-xl border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isBriefExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Export Aggregate Brief'}
                            </button>
                            {briefExportMessage && (
                                <p className="text-xs text-gray-600">{briefExportMessage}</p>
                            )}
                        </div>
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            onSubmitForecast();
                        }}
                        className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-5"
                    >
                        <input
                            type="text"
                            value={targetVideoId}
                            onChange={(event) => setTargetVideoId(event.target.value)}
                            placeholder="Target video ID (your video)"
                            className="md:col-span-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                        <input
                            type="text"
                            value={forecastSeedVideoId}
                            onChange={(event) => setForecastSeedVideoId(event.target.value)}
                            placeholder="Optional context seed video ID"
                            className="md:col-span-2 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                        <input
                            type="number"
                            min={5}
                            max={120}
                            value={beamWidth}
                            onChange={(event) => setBeamWidth(Math.min(120, Math.max(5, Number(event.target.value) || 5)))}
                            className="rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            title="Beam width"
                        />
                        <button
                            type="submit"
                            disabled={isForecastLoading}
                            className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isForecastLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Forecast'}
                        </button>
                    </form>

                    {forecastError && (
                        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {forecastError}
                        </div>
                    )}

                    {forecast && (
                        <div className="space-y-5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
                                <ForecastMetric title="Compared Users" value={forecast.networkEffect.comparedUsers} />
                                <ForecastMetric title="Pairwise Compares" value={forecast.networkEffect.pairwiseComparisons} />
                                <ForecastMetric title="Transitions" value={forecast.networkEffect.comparedTransitions} />
                                <ForecastMetric title="Network Strength" value={`${Math.round(forecast.networkEffect.networkStrength * 100)}%`} />
                                <ForecastMetric title="Global Exposure" value={`${Math.round(forecast.global.targetExposureRate * 100)}%`} />
                                <ForecastMetric
                                    title="Reliability"
                                    value={isEvaluationLoading
                                        ? '...'
                                        : evaluation
                                            ? `${Math.round(evaluation.metrics.reliabilityScore * 100)}%`
                                            : '-'}
                                />
                            </div>
                            <p className="text-xs text-gray-500 -mt-2">
                                Holdout evaluation (train older snapshots, test newer): top-{evaluation?.metrics.topK ?? 5}
                                {' '}hit {evaluation ? `${Math.round(evaluation.metrics.topKReachHitRate * 100)}%` : '-'},
                                {' '}precision {evaluation ? `${Math.round(evaluation.metrics.precisionAtK * 100)}%` : '-'},
                                {' '}calibration {evaluation ? `${Math.round(evaluation.metrics.calibrationScore * 100)}%` : '-'}.
                            </p>

                            <div className={`rounded-xl border px-3 py-2 text-xs ${forecast.qualityGate.status === 'degraded'
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                }`}
                            >
                                Parser coverage: {Math.round(forecast.qualityGate.parseCoverage * 100)}%
                                {' '}| parser drop: {Math.round(forecast.qualityGate.parserDropRate * 100)}%
                                {' '}| minimum target: {Math.round(forecast.qualityGate.minimumParseCoverage * 100)}%
                                {forecast.qualityGate.status === 'degraded'
                                    ? ' | Confidence is currently degraded for forecast scoring.'
                                    : ' | Confidence quality gate passed.'}
                            </div>

                            {forecast.qualityGate.degradationReasons.length > 0 && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                                    <p className="text-sm font-semibold text-amber-900">Forecast confidence is currently degraded</p>
                                    <p className="mt-1 text-sm text-amber-800">
                                        The model is still available, but one or more observatory quality gates are below target. Review the signals below before treating the cohort ranking as strong evidence.
                                    </p>
                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                                        <ForecastMetric title="Parser Coverage" value={`${Math.round(forecast.qualityGate.parseCoverage * 100)}%`} />
                                        <ForecastMetric title="Parser Drop" value={`${Math.round(forecast.qualityGate.parserDropRate * 100)}%`} />
                                        <ForecastMetric title="Metadata Integrity" value={`${Math.round(forecast.qualityGate.metadataIntegrityScore * 100)}%`} />
                                        <ForecastMetric title="Compared Users" value={forecast.qualityGate.comparedUsers} />
                                        <ForecastMetric title="Cohort Stability" value={`${Math.round(forecast.qualityGate.cohortStabilityScore * 100)}%`} />
                                    </div>
                                    <ul className="mt-3 space-y-2 text-sm text-amber-900">
                                        {forecast.qualityGate.degradationReasons.map((reason) => (
                                            <li key={reason} className="rounded-lg bg-white/70 px-3 py-2 border border-amber-100">
                                                {reason}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="rounded-xl border border-gray-200 overflow-hidden">
                                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <Sigma className="w-4 h-4 text-emerald-600" />
                                        Aggregate Audience Cohorts
                                    </h3>
                                    <span className="text-xs text-gray-500">
                                        Sorted by probability, fit, and cohort evidence
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-white border-b border-gray-100">
                                            <tr className="text-left text-gray-600">
                                                <th className="px-4 py-3 font-semibold">Cohort</th>
                                                <th className="px-4 py-3 font-semibold">Users</th>
                                                <th className="px-4 py-3 font-semibold">Exposure</th>
                                                <th className="px-4 py-3 font-semibold">Reach from Seed</th>
                                                <th className="px-4 py-3 font-semibold">Lift vs Global</th>
                                                <th className="px-4 py-3 font-semibold">Fit</th>
                                                <th className="px-4 py-3 font-semibold">Score</th>
                                                <th className="px-4 py-3 font-semibold">Reliability</th>
                                                <th className="px-4 py-3 font-semibold">Drilldown</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(forecast.recommendedAudienceCohorts.length > 0
                                                ? forecast.recommendedAudienceCohorts
                                                : forecast.cohorts.slice(0, 8)
                                            ).map((cohort) => (
                                                <CohortRow
                                                    key={cohort.cohortId}
                                                    cohort={cohort}
                                                    reliabilityScore={
                                                        evaluation?.cohortMetrics.find((entry) => entry.cohortId === cohort.cohortId)?.reliabilityScore
                                                        ?? evaluation?.metrics.reliabilityScore
                                                        ?? null
                                                    }
                                                    reliabilitySampleSize={
                                                        evaluation?.cohortMetrics.find((entry) => entry.cohortId === cohort.cohortId)?.sampleSize
                                                        ?? evaluation?.metrics.sampleSize
                                                        ?? null
                                                    }
                                                    onViewMap={() => onViewCohortMap(cohort)}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </ErrorBoundary>
        </>
    );
}

function ForecastMetric({ title, value }: { title: string; value: number | string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
        </div>
    );
}

function CohortRow({
    cohort,
    reliabilityScore,
    reliabilitySampleSize,
    onViewMap,
}: {
    cohort: CohortAudienceForecast;
    reliabilityScore: number | null;
    reliabilitySampleSize: number | null;
    onViewMap: () => void;
}) {
    return (
        <tr className="border-b border-gray-100 last:border-0">
            <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{cohort.cohortLabel}</div>
                <div className="text-xs text-gray-500">{cohort.cohortId}</div>
            </td>
            <td className="px-4 py-3 text-gray-700">{cohort.users.toLocaleString()}</td>
            <td className="px-4 py-3 text-gray-700">
                {Math.round(cohort.targetExposureRate * 100)}%
                <span className="text-xs text-gray-500 ml-1">
                    ({Math.round(cohort.exposureConfidenceInterval.low * 100)}-{Math.round(cohort.exposureConfidenceInterval.high * 100)}%)
                </span>
            </td>
            <td className="px-4 py-3 text-gray-700">{Math.round((cohort.reachProbabilityFromSeed ?? 0) * 100)}%</td>
            <td className="px-4 py-3 text-gray-700">
                {cohort.relativeLiftVsGlobalExposure ? `${cohort.relativeLiftVsGlobalExposure.toFixed(2)}x` : '-'}
            </td>
            <td className="px-4 py-3 text-gray-700">{Math.round(cohort.fitScore * 100)}%</td>
            <td className="px-4 py-3 text-gray-900 font-semibold">{cohort.score.toFixed(3)}</td>
            <td className="px-4 py-3 text-gray-700">
                {reliabilityScore !== null ? `${Math.round(reliabilityScore * 100)}%` : '-'}
                {reliabilitySampleSize !== null ? (
                    <span className="ml-1 text-xs text-gray-500">(n={reliabilitySampleSize})</span>
                ) : null}
            </td>
            <td className="px-4 py-3">
                <button
                    type="button"
                    onClick={onViewMap}
                    className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                    View In Map
                </button>
            </td>
        </tr>
    );
}
