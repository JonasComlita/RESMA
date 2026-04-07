import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Navbar } from '../components/Navbar';
import { RecommendationGraphCanvas } from '../components/RecommendationGraphCanvas';
import { BarChart2, Users, Database, Video, Network, Loader2, Target, Sigma, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import type {
    RecommendationMapResult,
    TraversalSummary,
    TraversalVisitStep,
} from '../types/recommendationMap';
import type { AudienceForecastResult, CohortAudienceForecast } from '../types/audienceForecast';
import type { ForecastEvaluationResult } from '../types/forecastEvaluation';
import type { DataQualityDiagnosticsResult, DataQualityTrendResult } from '../types/dataQuality';
import type { GoToMarketBriefResult } from '../types/goToMarketBrief';

interface GlobalStats {
    totalUsers: number;
    totalSnapshots: number;
    totalFeedItems: number;
    totalCreators: number;
    recentSnapshots: number;
}

const DEFAULT_QUALITY_WINDOW_HOURS = 24 * 14;
const DEFAULT_QUALITY_TREND_BUCKET_HOURS = 24;
const QUALITY_THRESHOLDS_STORAGE_KEY = 'resmaDataQualityThresholdsV1';
const QUALITY_WINDOW_OPTIONS = [
    { label: '7d', hours: 24 * 7 },
    { label: '14d', hours: 24 * 14 },
    { label: '30d', hours: 24 * 30 },
    { label: '60d', hours: 24 * 60 },
    { label: '90d', hours: 24 * 90 },
];
const QUALITY_BUCKET_OPTIONS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
];

interface QualityThresholds {
    parserDropWarn: number;
    parserDropCritical: number;
    stabilityWarn: number;
    stabilityCritical: number;
    fingerprintCoverageWarn: number;
}

const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
    parserDropWarn: 0.3,
    parserDropCritical: 0.5,
    stabilityWarn: 0.75,
    stabilityCritical: 0.6,
    fingerprintCoverageWarn: 0.6,
};

export function Dashboard() {
    const { user, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState<GlobalStats | null>(null);
    const [seedVideoId, setSeedVideoId] = useState('');
    const [maxDepth, setMaxDepth] = useState(3);
    const [maxNodes, setMaxNodes] = useState(60);
    const [platform, setPlatform] = useState('youtube');
    const [mapResult, setMapResult] = useState<RecommendationMapResult | null>(null);
    const [mapError, setMapError] = useState<string | null>(null);
    const [isMapLoading, setIsMapLoading] = useState(false);
    const [targetVideoId, setTargetVideoId] = useState('');
    const [forecastSeedVideoId, setForecastSeedVideoId] = useState('');
    const [beamWidth, setBeamWidth] = useState(30);
    const [forecast, setForecast] = useState<AudienceForecastResult | null>(null);
    const [forecastError, setForecastError] = useState<string | null>(null);
    const [isForecastLoading, setIsForecastLoading] = useState(false);
    const [evaluation, setEvaluation] = useState<ForecastEvaluationResult | null>(null);
    const [isEvaluationLoading, setIsEvaluationLoading] = useState(false);
    const [dataQuality, setDataQuality] = useState<DataQualityDiagnosticsResult | null>(null);
    const [dataQualityTrend, setDataQualityTrend] = useState<DataQualityTrendResult | null>(null);
    const [dataQualityError, setDataQualityError] = useState<string | null>(null);
    const [isDataQualityLoading, setIsDataQualityLoading] = useState(false);
    const [qualityWindowHours, setQualityWindowHours] = useState(DEFAULT_QUALITY_WINDOW_HOURS);
    const [qualityBucketHours, setQualityBucketHours] = useState(DEFAULT_QUALITY_TREND_BUCKET_HOURS);
    const [qualityThresholds, setQualityThresholds] = useState<QualityThresholds>(DEFAULT_QUALITY_THRESHOLDS);
    const [isBriefExporting, setIsBriefExporting] = useState(false);
    const [briefExportMessage, setBriefExportMessage] = useState<string | null>(null);
    const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
    const [selectedCohortLabel, setSelectedCohortLabel] = useState<string | null>(null);

    useEffect(() => {
        if (!isLoading && !user) {
            navigate('/login');
        }
    }, [user, isLoading, navigate]);

    useEffect(() => {
        if (user) {
            api.get<{ stats: GlobalStats }>('/analysis/stats')
                .then(data => setStats(data.stats))
                .catch(console.error);
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            loadDataQuality({
                targetPlatform: platform,
                windowHours: qualityWindowHours,
                bucketHours: qualityBucketHours,
                keepExisting: true,
            });
        }
    }, [user, platform, qualityWindowHours, qualityBucketHours]);

    useEffect(() => {
        if (qualityBucketHours > qualityWindowHours) {
            setQualityBucketHours(qualityWindowHours);
        }
    }, [qualityWindowHours, qualityBucketHours]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(QUALITY_THRESHOLDS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as Partial<QualityThresholds>;
            setQualityThresholds((current) => ({
                parserDropWarn: typeof parsed.parserDropWarn === 'number' ? parsed.parserDropWarn : current.parserDropWarn,
                parserDropCritical: typeof parsed.parserDropCritical === 'number' ? parsed.parserDropCritical : current.parserDropCritical,
                stabilityWarn: typeof parsed.stabilityWarn === 'number' ? parsed.stabilityWarn : current.stabilityWarn,
                stabilityCritical: typeof parsed.stabilityCritical === 'number' ? parsed.stabilityCritical : current.stabilityCritical,
                fingerprintCoverageWarn: typeof parsed.fingerprintCoverageWarn === 'number'
                    ? parsed.fingerprintCoverageWarn
                    : current.fingerprintCoverageWarn,
            }));
        } catch {
            // Ignore malformed local storage payloads.
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(QUALITY_THRESHOLDS_STORAGE_KEY, JSON.stringify(qualityThresholds));
    }, [qualityThresholds]);

    if (isLoading || !user) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    const loadRecommendationMap = ({
        seed,
        cohortId,
        cohortLabel,
    }: {
        seed: string;
        cohortId?: string;
        cohortLabel?: string;
    }) => {
        const cleanedSeed = seed.trim();
        if (!cleanedSeed) {
            setMapError('Enter a seed YouTube video ID to build the map.');
            return;
        }

        setMapError(null);
        setIsMapLoading(true);
        setSelectedCohortId(cohortId ?? null);
        setSelectedCohortLabel(cohortLabel ?? null);

        const query = new URLSearchParams({
            seedVideoId: cleanedSeed,
            maxDepth: String(maxDepth),
            maxNodes: String(maxNodes),
            platform,
        });

        if (cohortId) {
            query.set('cohortId', cohortId);
        }

        api.get<{ map: RecommendationMapResult }>(`/analysis/recommendation-map?${query.toString()}`)
            .then((data) => setMapResult(data.map))
            .catch((error: Error) => {
                setMapResult(null);
                setMapError(error.message || 'Unable to build recommendation map.');
            })
            .finally(() => setIsMapLoading(false));
    };

    const loadForecastEvaluation = (targetPlatform: string) => {
        setIsEvaluationLoading(true);
        const query = new URLSearchParams({
            platform: targetPlatform,
            topK: '5',
        });

        api.get<{ evaluation: ForecastEvaluationResult }>(`/analysis/forecast-evaluation?${query.toString()}`)
            .then((data) => setEvaluation(data.evaluation))
            .catch(() => setEvaluation(null))
            .finally(() => setIsEvaluationLoading(false));
    };

    const loadDataQuality = ({
        targetPlatform,
        windowHours,
        bucketHours,
        keepExisting = false,
    }: {
        targetPlatform: string;
        windowHours: number;
        bucketHours: number;
        keepExisting?: boolean;
    }) => {
        setIsDataQualityLoading(true);
        setDataQualityError(null);
        if (!keepExisting) {
            setDataQuality(null);
            setDataQualityTrend(null);
        }

        const query = new URLSearchParams({
            platform: targetPlatform,
            windowHours: String(windowHours),
        });

        const trendQuery = new URLSearchParams({
            platform: targetPlatform,
            windowHours: String(windowHours),
            bucketHours: String(bucketHours),
        });

        Promise.allSettled([
            api.get<{ diagnostics: DataQualityDiagnosticsResult }>(`/analysis/data-quality?${query.toString()}`),
            api.get<{ trends: DataQualityTrendResult }>(`/analysis/data-quality-trends?${trendQuery.toString()}`),
        ])
            .then(([diagnosticsResult, trendResult]) => {
                if (diagnosticsResult.status === 'fulfilled') {
                    setDataQuality(diagnosticsResult.value.diagnostics);
                } else {
                    setDataQuality(null);
                    setDataQualityError(diagnosticsResult.reason?.message || 'Unable to load data quality diagnostics.');
                }

                if (trendResult.status === 'fulfilled') {
                    setDataQualityTrend(trendResult.value.trends);
                } else {
                    setDataQualityTrend(null);
                }
            })
            .finally(() => setIsDataQualityLoading(false));
    };

    const percentile = (values: number[], p: number): number => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((left, right) => left - right);
        const clampedP = Math.max(0, Math.min(1, p));
        const index = Math.min(
            sorted.length - 1,
            Math.max(0, Math.round((sorted.length - 1) * clampedP))
        );
        return sorted[index];
    };

    const autoTuneQualityThresholds = () => {
        if (!dataQualityTrend || dataQualityTrend.points.length === 0 || !dataQuality) {
            setQualityThresholds(DEFAULT_QUALITY_THRESHOLDS);
            return;
        }

        const parserSeries = dataQualityTrend.points
            .map((point) => point.parserDropRate)
            .filter((value) => Number.isFinite(value));
        const stabilitySeries = dataQualityTrend.points
            .map((point) => point.cohortStabilityScore)
            .filter((value) => Number.isFinite(value));
        const fingerprintCoverage = dataQuality.stitching.totalSnapshots > 0
            ? dataQuality.stitching.snapshotsWithQualityFingerprint / dataQuality.stitching.totalSnapshots
            : DEFAULT_QUALITY_THRESHOLDS.fingerprintCoverageWarn;

        const tuned = normalizeThresholds({
            parserDropWarn: clampUnit(percentile(parserSeries, 0.75) + 0.02),
            parserDropCritical: clampUnit(percentile(parserSeries, 0.9) + 0.04),
            stabilityWarn: clampUnit(percentile(stabilitySeries, 0.25) - 0.01),
            stabilityCritical: clampUnit(percentile(stabilitySeries, 0.1) - 0.02),
            fingerprintCoverageWarn: clampUnit(fingerprintCoverage - 0.08),
        });

        setQualityThresholds(tuned);
    };

    const downloadTextFile = (filename: string, content: string, mimeType = 'text/markdown;charset=utf-8') => {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const exportGoToMarketBrief = () => {
        const cleanedTarget = targetVideoId.trim() || forecast?.targetVideoId || '';
        if (!cleanedTarget) {
            setBriefExportMessage('Enter a target video ID before exporting.');
            return;
        }

        setIsBriefExporting(true);
        setBriefExportMessage(null);

        const seedCandidate = forecastSeedVideoId.trim() || forecast?.seedVideoId || '';
        const query = new URLSearchParams({
            targetVideoId: cleanedTarget,
            platform,
            maxDepth: String(maxDepth),
            beamWidth: String(beamWidth),
            topCohorts: '5',
            maxPathsPerCohort: '3',
            pathBranchLimit: '6',
        });

        if (seedCandidate) {
            query.set('seedVideoId', seedCandidate);
        }

        api.get<{ brief: GoToMarketBriefResult }>(`/analysis/go-to-market-brief?${query.toString()}`)
            .then((data) => {
                const brief = data.brief;
                const dateStamp = brief.generatedAt.slice(0, 10);
                const filename = `go-to-market-brief-${brief.platform}-${brief.targetVideoId}-${dateStamp}.md`;
                downloadTextFile(filename, brief.markdown);
                setBriefExportMessage(`Brief exported: ${filename}`);
            })
            .catch((error: Error) => {
                setBriefExportMessage(error.message || 'Unable to export the Go-to-market brief.');
            })
            .finally(() => setIsBriefExporting(false));
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                        <p className="text-gray-600">Welcome back, {user.anonymousId}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="text-sm text-gray-500 hover:text-gray-900 underline"
                    >
                        Log out
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
                    <StatCard title="Total Users" value={stats?.totalUsers} icon={<Users className="w-6 h-6 text-white" />} color="bg-blue-500" />
                    <StatCard title="Feed Snapshots" value={stats?.totalSnapshots} icon={<Database className="w-6 h-6 text-white" />} color="bg-green-500" />
                    <StatCard title="Videos Analyzed" value={stats?.totalFeedItems} icon={<Video className="w-6 h-6 text-white" />} color="bg-purple-500" />
                    <StatCard title="Creators Tracked" value={stats?.totalCreators} icon={<BarChart2 className="w-6 h-6 text-white" />} color="bg-orange-500" />
                </div>

                {/* Data Quality Health */}
                <div className="bg-white p-6 rounded-2xl shadow-sm mb-8">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                                Cross-User Data Quality
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                                Tracks stitching, dedupe, parser strictness, and cohort stability so forecast quality improves as comparisons scale.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <select
                                value={qualityWindowHours}
                                onChange={(event) => setQualityWindowHours(Number(event.target.value))}
                                className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 bg-white"
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
                                className="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 bg-white"
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
                                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isDataQualityLoading
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <RefreshCw className="w-3.5 h-3.5" />}
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                                <MapMetric title="Dedupe Rate" value={`${Math.round(dataQuality.stitching.duplicateRate * 100)}%`} />
                                <MapMetric title="Parse Coverage" value={`${Math.round(dataQuality.recommendations.parseCoverage * 100)}%`} />
                                <MapMetric title="Parser Drop" value={`${Math.round(dataQuality.recommendations.parserDropRate * 100)}%`} />
                                <MapMetric title="Cohort Stability" value={`${Math.round(dataQuality.cohorts.stabilityScore * 100)}%`} />
                                <MapMetric title="Network Strength" value={`${Math.round(dataQuality.cohorts.networkStrength * 100)}%`} />
                                <MapMetric title="Stitched Sessions" value={dataQuality.stitching.stitchedSessions} />
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">Alert Thresholds</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
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
                                </div>
                                <div className="flex items-center justify-end gap-2 mt-3">
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
                                        className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Auto-Tune
                                    </button>
                                </div>
                            </div>

                            <QualityAlerts diagnostics={dataQuality} thresholds={qualityThresholds} />

                            {dataQualityTrend && dataQualityTrend.points.length > 0 && (
                                <div className="rounded-xl border border-gray-200 p-4">
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Quality Trend</h3>
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

                {/* Charts Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm mb-8">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">Data Overview</h2>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[
                                { name: 'Users', value: stats?.totalUsers || 0 },
                                { name: 'Snapshots', value: stats?.totalSnapshots || 0 },
                                { name: 'Videos (x100)', value: (stats?.totalFeedItems || 0) / 100 },
                                { name: 'Creators', value: stats?.totalCreators || 0 },
                            ]}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="value" fill="#8884d8" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Recommendation Map Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Network className="w-5 h-5 text-blue-600" />
                                Recommendation Map
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                                BFS and DFS run in parallel behind the scenes to map where recommendations converge or diverge.
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                                Scope: {selectedCohortId
                                    ? `Cohort (${selectedCohortLabel || selectedCohortId})`
                                    : 'Your personal feed'}
                            </p>
                        </div>
                        {selectedCohortId && (
                            <button
                                type="button"
                                className="self-start rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                    setSelectedCohortId(null);
                                    setSelectedCohortLabel(null);
                                    if (seedVideoId.trim()) {
                                        loadRecommendationMap({ seed: seedVideoId.trim() });
                                    }
                                }}
                            >
                                Use Personal Scope
                            </button>
                        )}
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            loadRecommendationMap({
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

                {/* Audience Forecast Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm mt-8">
                    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                <Target className="w-5 h-5 text-emerald-600" />
                                Cohort-Aware Audience Forecast
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                                Predicts who a target video is most likely to reach using cross-user cohort comparisons.
                                Model quality increases as more users compare feeds.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 md:items-end">
                            <button
                                type="button"
                                onClick={exportGoToMarketBrief}
                                disabled={isBriefExporting}
                                className="inline-flex items-center justify-center rounded-xl border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isBriefExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Export Go-to-market Brief'}
                            </button>
                            {briefExportMessage && (
                                <p className="text-xs text-gray-600">{briefExportMessage}</p>
                            )}
                        </div>
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            const cleanedTarget = targetVideoId.trim();
                            if (!cleanedTarget) {
                                setForecastError('Enter a target video ID.');
                                return;
                            }

                            setForecastError(null);
                            setBriefExportMessage(null);
                            setIsForecastLoading(true);
                            setEvaluation(null);

                            const query = new URLSearchParams({
                                targetVideoId: cleanedTarget,
                                platform,
                                maxDepth: String(maxDepth),
                                beamWidth: String(beamWidth),
                            });

                            const cleanedSeed = forecastSeedVideoId.trim();
                            if (cleanedSeed) {
                                query.set('seedVideoId', cleanedSeed);
                            }

                            api.get<{ forecast: AudienceForecastResult }>(`/analysis/audience-forecast?${query.toString()}`)
                                .then((data) => {
                                    setForecast(data.forecast);
                                    loadForecastEvaluation(platform);
                                })
                                .catch((error: Error) => {
                                    setForecast(null);
                                    setForecastError(error.message || 'Unable to generate audience forecast.');
                                })
                                .finally(() => setIsForecastLoading(false));
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
                                <MapMetric title="Compared Users" value={forecast.networkEffect.comparedUsers} />
                                <MapMetric title="Pairwise Compares" value={forecast.networkEffect.pairwiseComparisons} />
                                <MapMetric title="Transitions" value={forecast.networkEffect.comparedTransitions} />
                                <MapMetric title="Network Strength" value={`${Math.round(forecast.networkEffect.networkStrength * 100)}%`} />
                                <MapMetric title="Global Exposure" value={`${Math.round(forecast.global.targetExposureRate * 100)}%`} />
                                <MapMetric
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

                            <div className="rounded-xl border border-gray-200 overflow-hidden">
                                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <Sigma className="w-4 h-4 text-emerald-600" />
                                        Recommended Audience Cohorts
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
                                                    onViewMap={() => {
                                                        const drillSeed = seedVideoId.trim()
                                                            || forecastSeedVideoId.trim()
                                                            || targetVideoId.trim();

                                                        if (!drillSeed) {
                                                            setMapError('Set a map seed or forecast seed before cohort drilldown.');
                                                            return;
                                                        }

                                                        setSeedVideoId(drillSeed);
                                                        loadRecommendationMap({
                                                            seed: drillSeed,
                                                            cohortId: cohort.cohortId,
                                                            cohortLabel: cohort.cohortLabel,
                                                        });
                                                    }}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, color }: { title: string, value?: number, icon: React.ReactNode, color: string }) {
    return (
        <div className="bg-white overflow-hidden rounded-xl shadow-sm">
            <div className="p-5">
                <div className="flex items-center">
                    <div className={`flex-shrink-0 rounded-md p-3 ${color}`}>
                        {icon}
                    </div>
                    <div className="ml-5 w-0 flex-1">
                        <dl>
                            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
                            <dd>
                                <div className="text-2xl font-bold text-gray-900">{value !== undefined ? value.toLocaleString() : '-'}</div>
                            </dd>
                        </dl>
                    </div>
                </div>
            </div>
        </div>
    );
}

function MapMetric({ title, value }: { title: string; value: number | string }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
            <p className="text-xl font-semibold text-gray-900 mt-1">{value}</p>
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

    return {
        parserDropWarn: parserWarn,
        parserDropCritical: parserCritical,
        stabilityWarn,
        stabilityCritical,
        fingerprintCoverageWarn,
    };
}

function deriveQualityAlerts(
    diagnostics: DataQualityDiagnosticsResult,
    thresholds: QualityThresholds
): QualityAlert[] {
    const normalized = normalizeThresholds(thresholds);
    const alerts: QualityAlert[] = [];

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

    return alerts.slice(0, 4);
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
                            <AlertTriangle className={`w-4 h-4 mt-0.5 ${iconClass}`} />
                            <div>
                                <p className={`text-sm font-semibold ${titleClass}`}>{alert.title}</p>
                                <p className={`text-xs mt-0.5 ${detailClass}`}>{alert.detail}</p>
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
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
        </label>
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
