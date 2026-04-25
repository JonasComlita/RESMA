import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { ErrorBoundary } from '../ErrorBoundary';
import {
    DEFAULT_QUALITY_THRESHOLDS,
    QUALITY_BUCKET_OPTIONS,
    QUALITY_WINDOW_OPTIONS,
    SURFACE_TREND_COLORS,
    SURFACE_TREND_METRIC_OPTIONS,
    type QualityThresholds,
    type SurfaceTrendMetric,
} from '../../hooks/useDashboardDataQuality';
import type {
    DataQualityDiagnosticsResult,
    DataQualityTrendResult,
} from '../../types/dataQuality';
import { SandDanceExplorer } from './SandDanceExplorer';

interface DataQualitySectionProps {
    platform: string;
    dataQuality: DataQualityDiagnosticsResult | null;
    dataQualityTrend: DataQualityTrendResult | null;
    dataQualityError: string | null;
    isDataQualityLoading: boolean;
    qualityWindowHours: number;
    setQualityWindowHours: Dispatch<SetStateAction<number>>;
    qualityBucketHours: number;
    setQualityBucketHours: Dispatch<SetStateAction<number>>;
    qualityThresholds: QualityThresholds;
    setQualityThresholds: Dispatch<SetStateAction<QualityThresholds>>;
    surfaceTrendMetric: SurfaceTrendMetric;
    setSurfaceTrendMetric: Dispatch<SetStateAction<SurfaceTrendMetric>>;
    loadDataQuality: (args: {
        targetPlatform: string;
        windowHours: number;
        bucketHours: number;
        keepExisting?: boolean;
    }) => void;
    autoTuneQualityThresholds: () => void;
    surfaceTrendLeaders: string[];
    surfaceTrendSeries: Array<Record<string, string | number | null>>;
}

interface QualityAlert {
    id: string;
    severity: 'good' | 'warning' | 'critical';
    title: string;
    detail: string;
}

function clampUnit(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function normalizeThresholds(input: QualityThresholds): QualityThresholds {
    const parserWarn = clampUnit(Math.min(input.parserDropWarn, input.parserDropCritical));
    const parserCritical = clampUnit(Math.max(input.parserDropWarn, input.parserDropCritical));
    const stabilityCritical = clampUnit(Math.min(input.stabilityCritical, input.stabilityWarn));
    const stabilityWarn = clampUnit(Math.max(input.stabilityCritical, input.stabilityWarn));
    const fingerprintCoverageWarn = clampUnit(input.fingerprintCoverageWarn);
    const surfaceParserDropWarn = clampUnit(Math.min(input.surfaceParserDropWarn, input.surfaceParserDropCritical));
    const surfaceParserDropCritical = clampUnit(Math.max(input.surfaceParserDropWarn, input.surfaceParserDropCritical));
    const surfaceStabilityCritical = clampUnit(Math.min(input.surfaceStabilityCritical, input.surfaceStabilityWarn));
    const surfaceStabilityWarn = clampUnit(Math.max(input.surfaceStabilityCritical, input.surfaceStabilityWarn));

    return {
        parserDropWarn: parserWarn,
        parserDropCritical: parserCritical,
        stabilityWarn,
        stabilityCritical,
        fingerprintCoverageWarn,
        surfaceParserDropWarn,
        surfaceParserDropCritical,
        surfaceStabilityWarn,
        surfaceStabilityCritical,
    };
}

function deriveQualityAlerts(
    diagnostics: DataQualityDiagnosticsResult,
    thresholds: QualityThresholds
): QualityAlert[] {
    const normalized = normalizeThresholds(thresholds);
    const alerts: QualityAlert[] = [];
    const minSurfaceRowsForAlerts = 20;

    if (diagnostics.recommendations.parserDropRate >= normalized.parserDropCritical) {
        alerts.push({
            id: 'parser-drop-critical',
            severity: 'critical',
            title: 'Parser Loss Is High',
            detail: 'Strict parsing is dropping too many recommendation rows for reliable transition modeling.',
        });
    } else if (diagnostics.recommendations.parserDropRate >= normalized.parserDropWarn) {
        alerts.push({
            id: 'parser-drop-warning',
            severity: 'warning',
            title: 'Parser Loss Needs Attention',
            detail: 'Strict parsing is dropping a meaningful share of recommendation rows.',
        });
    } else {
        alerts.push({
            id: 'parser-drop-good',
            severity: 'good',
            title: 'Parser Quality Looks Healthy',
            detail: 'Strict parser retention is stable for current captured recommendation rows.',
        });
    }

    if (diagnostics.cohorts.stabilityScore < normalized.stabilityCritical) {
        alerts.push({
            id: 'cohort-stability-critical',
            severity: 'critical',
            title: 'Cohort Stability Is Low',
            detail: 'Small-fragment cohort share is high, so transitions may still be noisy.',
        });
    } else if (diagnostics.cohorts.stabilityScore < normalized.stabilityWarn) {
        alerts.push({
            id: 'cohort-stability-warning',
            severity: 'warning',
            title: 'Cohort Stability Is Moderate',
            detail: 'Model is usable but should improve with more cross-user comparisons.',
        });
    } else {
        alerts.push({
            id: 'cohort-stability-good',
            severity: 'good',
            title: 'Cohort Stability Is Strong',
            detail: 'Cohort assignments are stable with low fragmentation.',
        });
    }

    const fingerprintCoverage = diagnostics.stitching.totalSnapshots > 0
        ? diagnostics.stitching.snapshotsWithQualityFingerprint / diagnostics.stitching.totalSnapshots
        : 0;
    if (fingerprintCoverage < normalized.fingerprintCoverageWarn) {
        alerts.push({
            id: 'fingerprint-coverage-warning',
            severity: 'warning',
            title: 'Metadata Coverage Is Incomplete',
            detail: 'Many snapshots are missing quality fingerprint metadata from ingestion.',
        });
    }
    if (diagnostics.stitching.invalidMetadataSnapshots > 0) {
        alerts.push({
            id: 'metadata-integrity-warning',
            severity: diagnostics.stitching.metadataIntegrityScore < 0.7 ? 'critical' : 'warning',
            title: 'Some Session Metadata Failed To Decode',
            detail: `${diagnostics.stitching.invalidMetadataSnapshots} snapshot(s) had invalid session metadata, which reduces stitching confidence.`,
        });
    }

    const surfacedRecommendations = diagnostics.recommendations.bySurface
        .filter((surface) => surface.rawRows >= minSurfaceRowsForAlerts || surface.strictRows >= minSurfaceRowsForAlerts);

    if (surfacedRecommendations.length > 0) {
        const highestSurfaceDrop = [...surfacedRecommendations]
            .sort((left, right) => right.parserDropRate - left.parserDropRate)[0];
        if (highestSurfaceDrop.parserDropRate >= normalized.surfaceParserDropCritical) {
            alerts.push({
                id: `surface-drop-critical-${highestSurfaceDrop.surface}`,
                severity: 'critical',
                title: `High Surface Parser Loss (${highestSurfaceDrop.surface})`,
                detail: `${Math.round(highestSurfaceDrop.parserDropRate * 100)}% of rows are dropped on this surface; prediction transitions may be biased.`,
            });
        } else if (highestSurfaceDrop.parserDropRate >= normalized.surfaceParserDropWarn) {
            alerts.push({
                id: `surface-drop-warning-${highestSurfaceDrop.surface}`,
                severity: 'warning',
                title: `Surface Parser Loss Rising (${highestSurfaceDrop.surface})`,
                detail: `${Math.round(highestSurfaceDrop.parserDropRate * 100)}% row drop rate suggests parser drift on this recommendation surface.`,
            });
        }

        const lowestSurfaceStability = [...surfacedRecommendations]
            .sort((left, right) => left.transitionStabilityScore - right.transitionStabilityScore)[0];
        if (lowestSurfaceStability.transitionStabilityScore <= normalized.surfaceStabilityCritical) {
            alerts.push({
                id: `surface-stability-critical-${lowestSurfaceStability.surface}`,
                severity: 'critical',
                title: `Surface Transition Stability Is Low (${lowestSurfaceStability.surface})`,
                detail: `${Math.round(lowestSurfaceStability.transitionStabilityScore * 100)}% repeat strength indicates noisy transitions on this surface.`,
            });
        } else if (lowestSurfaceStability.transitionStabilityScore <= normalized.surfaceStabilityWarn) {
            alerts.push({
                id: `surface-stability-warning-${lowestSurfaceStability.surface}`,
                severity: 'warning',
                title: `Surface Transition Stability Needs Work (${lowestSurfaceStability.surface})`,
                detail: `${Math.round(lowestSurfaceStability.transitionStabilityScore * 100)}% repeat strength is below target for stable pathing.`,
            });
        }
    }

    const severityRank: Record<QualityAlert['severity'], number> = {
        critical: 0,
        warning: 1,
        good: 2,
    };

    return alerts
        .sort((left, right) => {
            const severityDiff = severityRank[left.severity] - severityRank[right.severity];
            if (severityDiff !== 0) {
                return severityDiff;
            }
            return left.title.localeCompare(right.title);
        })
        .slice(0, 6);
}

function QualityAlerts({
    diagnostics,
    thresholds,
}: {
    diagnostics: DataQualityDiagnosticsResult;
    thresholds: QualityThresholds;
}) {
    const alerts = deriveQualityAlerts(diagnostics, thresholds);

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {alerts.map((alert) => {
                const isCritical = alert.severity === 'critical';
                const isWarning = alert.severity === 'warning';
                const boxClass = isCritical
                    ? 'border-red-200 bg-red-50'
                    : isWarning
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-emerald-200 bg-emerald-50';
                const iconClass = isCritical
                    ? 'text-red-600'
                    : isWarning
                        ? 'text-amber-600'
                        : 'text-emerald-600';
                const titleClass = isCritical
                    ? 'text-red-800'
                    : isWarning
                        ? 'text-amber-800'
                        : 'text-emerald-800';
                const detailClass = isCritical
                    ? 'text-red-700'
                    : isWarning
                        ? 'text-amber-700'
                        : 'text-emerald-700';

                return (
                    <div key={alert.id} className={`rounded-xl border px-3 py-2 ${boxClass}`}>
                        <div className="flex items-start gap-2">
                            <AlertTriangle className={`mt-0.5 h-4 w-4 ${iconClass}`} />
                            <div>
                                <p className={`text-sm font-semibold ${titleClass}`}>{alert.title}</p>
                                <p className={`mt-0.5 text-xs ${detailClass}`}>{alert.detail}</p>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ThresholdInput({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-500">{label}</span>
            <input
                type="number"
                min={0}
                max={100}
                value={Math.round(value * 100)}
                onChange={(event) => {
                    const parsed = Number(event.target.value);
                    const clamped = Math.max(0, Math.min(100, Number.isFinite(parsed) ? parsed : 0));
                    onChange(clamped / 100);
                }}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
            />
        </label>
    );
}

function MetricCard({ title, value }: { title: string; value: number | string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
        </div>
    );
}

export function DataQualitySection({
    platform,
    dataQuality,
    dataQualityTrend,
    dataQualityError,
    isDataQualityLoading,
    qualityWindowHours,
    setQualityWindowHours,
    qualityBucketHours,
    setQualityBucketHours,
    qualityThresholds,
    setQualityThresholds,
    surfaceTrendMetric,
    setSurfaceTrendMetric,
    loadDataQuality,
    autoTuneQualityThresholds,
    surfaceTrendLeaders,
    surfaceTrendSeries,
}: DataQualitySectionProps) {
    const [showSurfaceExplorer, setShowSurfaceExplorer] = useState(false);
    const surfaceExplorerRows = useMemo<Record<string, unknown>[]>(() => (
        dataQuality?.recommendations.bySurface.map((surface) => ({
            surface: surface.surface,
            rawRows: surface.rawRows,
            strictRows: surface.strictRows,
            parseCoverage: surface.parseCoverage,
            parserDropRate: surface.parserDropRate,
            uniqueTransitions: surface.uniqueTransitions,
            transitionStabilityScore: surface.transitionStabilityScore,
        })) ?? []
    ), [dataQuality]);

    return (
        <ErrorBoundary
            title="Cross-user data quality failed to render."
            description="Quality diagnostics are temporarily unavailable, but the rest of the observatory can still load."
            resetKey={`${platform}:${qualityWindowHours}:${qualityBucketHours}:${dataQuality?.generatedAt ?? 'none'}`}
        >
            <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-900">
                            <ShieldCheck className="h-5 w-5 text-emerald-600" />
                            Cross-User Data Quality
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                            Tracks stitching, dedupe, parser strictness, and cohort stability so forecast quality improves as comparisons scale.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={qualityWindowHours}
                            onChange={(event) => setQualityWindowHours(Number(event.target.value))}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700"
                        >
                            {QUALITY_WINDOW_OPTIONS.map((option) => (
                                <option key={`window-${option.hours}`} value={option.hours}>
                                    Window {option.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={qualityBucketHours}
                            onChange={(event) => setQualityBucketHours(Number(event.target.value))}
                            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700"
                        >
                            {QUALITY_BUCKET_OPTIONS
                                .filter((option) => option.hours <= qualityWindowHours)
                                .map((option) => (
                                    <option key={`bucket-${option.hours}`} value={option.hours}>
                                        Bucket {option.label}
                                    </option>
                                ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => loadDataQuality({
                                targetPlatform: platform,
                                windowHours: qualityWindowHours,
                                bucketHours: qualityBucketHours,
                                keepExisting: true,
                            })}
                            disabled={isDataQualityLoading}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isDataQualityLoading
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                            Refresh
                        </button>
                    </div>
                </div>

                {dataQualityError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {dataQualityError}
                    </div>
                )}

                {dataQuality ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-8">
                            <MetricCard title="Dedupe Rate" value={`${Math.round(dataQuality.stitching.duplicateRate * 100)}%`} />
                            <MetricCard title="Parse Coverage" value={`${Math.round(dataQuality.recommendations.parseCoverage * 100)}%`} />
                            <MetricCard title="Parser Drop" value={`${Math.round(dataQuality.recommendations.parserDropRate * 100)}%`} />
                            <MetricCard title="Metadata Integrity" value={`${Math.round(dataQuality.stitching.metadataIntegrityScore * 100)}%`} />
                            <MetricCard title="Surface Stability" value={`${Math.round(dataQuality.recommendations.surfaceTransitionStability * 100)}%`} />
                            <MetricCard title="Cohort Stability" value={`${Math.round(dataQuality.cohorts.stabilityScore * 100)}%`} />
                            <MetricCard title="Network Strength" value={`${Math.round(dataQuality.cohorts.networkStrength * 100)}%`} />
                            <MetricCard title="Stitched Sessions" value={dataQuality.stitching.stitchedSessions} />
                        </div>

                        {dataQuality.qualityGate.invalidMetadataSnapshots > 0 && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                <p className="text-sm font-semibold text-amber-800">Metadata integrity warning</p>
                                <p className="mt-1 text-sm text-amber-700">
                                    {dataQuality.qualityGate.invalidMetadataSnapshots} snapshot(s) in this window had session metadata that could not be decoded.
                                    Forecast stitching stays backward-compatible for older captures, but confidence is reduced until clean metadata coverage improves.
                                </p>
                            </div>
                        )}

                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <p className="mb-3 text-xs uppercase tracking-wide text-gray-500">Alert Thresholds</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                <ThresholdInput
                                    label="Parser Warn %"
                                    value={qualityThresholds.parserDropWarn}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, parserDropWarn: value }))}
                                />
                                <ThresholdInput
                                    label="Parser Critical %"
                                    value={qualityThresholds.parserDropCritical}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, parserDropCritical: value }))}
                                />
                                <ThresholdInput
                                    label="Stability Warn %"
                                    value={qualityThresholds.stabilityWarn}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, stabilityWarn: value }))}
                                />
                                <ThresholdInput
                                    label="Stability Critical %"
                                    value={qualityThresholds.stabilityCritical}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, stabilityCritical: value }))}
                                />
                                <ThresholdInput
                                    label="Fingerprint Warn %"
                                    value={qualityThresholds.fingerprintCoverageWarn}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, fingerprintCoverageWarn: value }))}
                                />
                                <ThresholdInput
                                    label="Surface Drop Warn %"
                                    value={qualityThresholds.surfaceParserDropWarn}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, surfaceParserDropWarn: value }))}
                                />
                                <ThresholdInput
                                    label="Surface Drop Critical %"
                                    value={qualityThresholds.surfaceParserDropCritical}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, surfaceParserDropCritical: value }))}
                                />
                                <ThresholdInput
                                    label="Surface Stability Warn %"
                                    value={qualityThresholds.surfaceStabilityWarn}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, surfaceStabilityWarn: value }))}
                                />
                                <ThresholdInput
                                    label="Surface Stability Critical %"
                                    value={qualityThresholds.surfaceStabilityCritical}
                                    onChange={(value) => setQualityThresholds((current) => ({ ...current, surfaceStabilityCritical: value }))}
                                />
                            </div>
                            <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setQualityThresholds(DEFAULT_QUALITY_THRESHOLDS)}
                                    className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
                                >
                                    Reset
                                </button>
                                <button
                                    type="button"
                                    onClick={autoTuneQualityThresholds}
                                    disabled={!dataQualityTrend || dataQualityTrend.points.length === 0}
                                    className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Auto-Tune
                                </button>
                            </div>
                        </div>

                        <QualityAlerts diagnostics={dataQuality} thresholds={qualityThresholds} />

                        {dataQuality.recommendations.bySurface.length > 0 && (
                            <div className="rounded-xl border border-gray-200 p-4">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900">Recommendation Surface Quality</h3>
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-xs">
                                        <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
                                            <tr className="text-left">
                                                <th className="px-3 py-2 font-semibold">Surface</th>
                                                <th className="px-3 py-2 font-semibold">Raw Rows</th>
                                                <th className="px-3 py-2 font-semibold">Strict Rows</th>
                                                <th className="px-3 py-2 font-semibold">Parse Coverage</th>
                                                <th className="px-3 py-2 font-semibold">Parser Drop</th>
                                                <th className="px-3 py-2 font-semibold">Transition Stability</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dataQuality.recommendations.bySurface.slice(0, 8).map((surface) => (
                                                <tr key={surface.surface} className="border-b border-gray-100 last:border-b-0">
                                                    <td className="px-3 py-2 font-medium text-gray-800">{surface.surface}</td>
                                                    <td className="px-3 py-2 text-gray-700">{surface.rawRows.toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-gray-700">{surface.strictRows.toLocaleString()}</td>
                                                    <td className="px-3 py-2 text-gray-700">{Math.round(surface.parseCoverage * 100)}%</td>
                                                    <td className="px-3 py-2 text-gray-700">{Math.round(surface.parserDropRate * 100)}%</td>
                                                    <td className="px-3 py-2 text-gray-700">{Math.round(surface.transitionStabilityScore * 100)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <p className="mt-2 text-[11px] text-gray-500">
                                    Surface stability is transition repeat strength within each recommendation surface after strict parsing.
                                </p>
                                <div className="mt-4 border-t border-gray-200 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setShowSurfaceExplorer((current) => !current)}
                                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                        {showSurfaceExplorer ? 'Hide SandDance Explorer' : 'Explore in SandDance'}
                                    </button>
                                    {showSurfaceExplorer && (
                                        <div className="mt-3">
                                            <SandDanceExplorer
                                                title="Surface Quality Explorer"
                                                data={surfaceExplorerRows}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {dataQualityTrend && dataQualityTrend.points.length > 0 && (
                            <div className="rounded-xl border border-gray-200 p-4">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900">Quality Trend</h3>
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart
                                            data={dataQualityTrend.points.map((point) => ({
                                                time: new Date(point.windowStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                                                dedupeRate: Math.round(point.dedupeRate * 100),
                                                parseCoverage: Math.round(point.parseCoverage * 100),
                                                parserDropRate: Math.round(point.parserDropRate * 100),
                                                stability: Math.round(point.cohortStabilityScore * 100),
                                            }))}
                                            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis domain={[0, 100]} />
                                            <Tooltip />
                                            <Legend />
                                            <Line type="monotone" dataKey="parseCoverage" name="Parse Coverage %" stroke="#2563eb" strokeWidth={2} dot={false} />
                                            <Line type="monotone" dataKey="stability" name="Cohort Stability %" stroke="#16a34a" strokeWidth={2} dot={false} />
                                            <Line type="monotone" dataKey="parserDropRate" name="Parser Drop %" stroke="#dc2626" strokeWidth={2} dot={false} />
                                            <Line type="monotone" dataKey="dedupeRate" name="Dedupe %" stroke="#f59e0b" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        {surfaceTrendSeries.length > 0 && (
                            <div className="rounded-xl border border-gray-200 p-4">
                                <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <h3 className="text-sm font-semibold text-gray-900">Surface Trend</h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {SURFACE_TREND_METRIC_OPTIONS.map((option) => {
                                            const isActive = surfaceTrendMetric === option.id;
                                            return (
                                                <button
                                                    key={`surface-metric-${option.id}`}
                                                    type="button"
                                                    onClick={() => setSurfaceTrendMetric(option.id)}
                                                    className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${isActive
                                                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                                                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="h-60 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart
                                            data={surfaceTrendSeries}
                                            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="time" />
                                            <YAxis domain={[0, 100]} />
                                            <Tooltip />
                                            <Legend />
                                            {surfaceTrendLeaders.map((surface, index) => (
                                                <Line
                                                    key={`surface-line-${surface}`}
                                                    type="monotone"
                                                    dataKey={`surface:${surface}`}
                                                    name={`${surface} %`}
                                                    stroke={SURFACE_TREND_COLORS[index % SURFACE_TREND_COLORS.length]}
                                                    strokeWidth={2}
                                                    dot={false}
                                                    connectNulls
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}

                        <p className="text-xs text-gray-500">
                            Compared users: {dataQuality.totals.users.toLocaleString()} | snapshots: {dataQuality.totals.snapshots.toLocaleString()}
                            {' '}({dataQuality.stitching.snapshotsAfterDedupe.toLocaleString()} after dedupe) | unique videos: {dataQuality.totals.uniqueVideos.toLocaleString()}.
                        </p>
                    </div>
                ) : (
                    <div className="text-sm text-gray-500">
                        {isDataQualityLoading ? 'Loading diagnostics...' : 'No diagnostics loaded yet.'}
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
}
