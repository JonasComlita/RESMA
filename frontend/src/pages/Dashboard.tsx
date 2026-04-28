import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import {
    useDashboardDataQuality,
} from '../hooks/useDashboardDataQuality';
import { useDashboardForecast } from '../hooks/useDashboardForecast';
import { useDashboardOppositeDiscovery } from '../hooks/useDashboardOppositeDiscovery';
import { useDashboardRecommendationMap } from '../hooks/useDashboardRecommendationMap';
import { useDashboardStore } from '../store/dashboardStore';
import { Navbar } from '../components/Navbar';
import { DataQualitySection } from '../components/dashboard/DataQualitySection';
import { DeleteAccountCard } from '../components/dashboard/DeleteAccountCard';
import { ForecastSection } from '../components/dashboard/ForecastSection';
import { OppositeDiscoverySection } from '../components/dashboard/OppositeDiscoverySection';
import { RecommendationMapSection } from '../components/dashboard/RecommendationMapSection';
import { BarChart2, Users, Database, Video } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface GlobalStats {
    totalUsers: number;
    totalSnapshots: number;
    totalFeedItems: number;
    totalCreators: number;
    recentSnapshots: number;
}

export function Dashboard() {
    const { user, isLoading, deleteAccount, logout } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState<GlobalStats | null>(null);
    const { platform, setPlatform, maxDepth, setMaxDepth } = useDashboardStore();
    const {
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
    } = useDashboardDataQuality(Boolean(user), platform);
    const {
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
        submitForecast,
        exportGoToMarketBrief,
        getForecastDrillSeed,
    } = useDashboardForecast(platform, maxDepth);
    const {
        seedVideoId,
        setSeedVideoId,
        maxNodes,
        setMaxNodes,
        mapResult,
        mapError,
        isMapLoading,
        selectedCohortId,
        loadRecommendationMap,
        resetToContributorScope,
        selectedCohortLabel,
        setMapError,
    } = useDashboardRecommendationMap(platform, maxDepth);
    const {
        oppositeDiscovery,
        oppositeDiscoveryError,
        isOppositeDiscoveryLoading,
        loadOppositeDiscovery,
    } = useDashboardOppositeDiscovery(Boolean(user), platform);

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

    if (isLoading || !user) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Observatory Dashboard</h1>
                        <p className="text-gray-600">Contributor ID: {user.anonymousId}</p>
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

                <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Contributor Observatory</p>
                    <p className="text-sm text-gray-600 mt-1">
                        Your captures stay pseudonymous and help power a shared recommendation observatory. Personal views stay scoped to your contributor account, while creator tooling only uses aggregate cohort outputs.
                    </p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-4 mb-8">
                    <div className="bg-white p-6 rounded-2xl shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Retention & Privacy</p>
                        <h2 className="mt-2 text-xl font-bold text-gray-900">Research-first, pseudonymous, contributor-controlled</h2>
                        <p className="mt-2 text-sm text-gray-600">
                            RESMA stores your contributor account, uploaded feed snapshots, and derived observatory analytics so recommendation research can accumulate over time.
                            Creator-facing outputs remain aggregate-only and never expose raw contributor feeds.
                        </p>
                        <p className="mt-3 text-xs text-gray-500">
                            You can permanently delete your contributor account and all associated observatory data from this dashboard at any time.
                        </p>
                    </div>

                    <DeleteAccountCard
                        anonymousId={user.anonymousId}
                        onDeleteAccount={deleteAccount}
                        onDeleted={() => navigate('/login')}
                    />
                </div>

                <DataQualitySection
                    platform={platform}
                    dataQuality={dataQuality}
                    dataQualityTrend={dataQualityTrend}
                    dataQualityError={dataQualityError}
                    isDataQualityLoading={isDataQualityLoading}
                    qualityWindowHours={qualityWindowHours}
                    setQualityWindowHours={setQualityWindowHours}
                    qualityBucketHours={qualityBucketHours}
                    setQualityBucketHours={setQualityBucketHours}
                    qualityThresholds={qualityThresholds}
                    setQualityThresholds={setQualityThresholds}
                    surfaceTrendMetric={surfaceTrendMetric}
                    setSurfaceTrendMetric={setSurfaceTrendMetric}
                    loadDataQuality={loadDataQuality}
                    autoTuneQualityThresholds={autoTuneQualityThresholds}
                    surfaceTrendLeaders={surfaceTrendLeaders}
                    surfaceTrendSeries={surfaceTrendSeries}
                />

                {/* Charts Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm mb-8">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">Observatory Snapshot</h2>
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

                <RecommendationMapSection
                    platform={platform}
                    setPlatform={setPlatform}
                    maxDepth={maxDepth}
                    setMaxDepth={setMaxDepth}
                    seedVideoId={seedVideoId}
                    setSeedVideoId={setSeedVideoId}
                    maxNodes={maxNodes}
                    setMaxNodes={setMaxNodes}
                    mapResult={mapResult}
                    mapError={mapError}
                    isMapLoading={isMapLoading}
                    selectedCohortId={selectedCohortId}
                    selectedCohortLabel={selectedCohortLabel}
                    onLoadRecommendationMap={loadRecommendationMap}
                    onResetToContributorScope={resetToContributorScope}
                />

                <OppositeDiscoverySection
                    platform={platform}
                    result={oppositeDiscovery}
                    error={oppositeDiscoveryError}
                    isLoading={isOppositeDiscoveryLoading}
                    onRefresh={() => loadOppositeDiscovery(platform, false)}
                />

                <ForecastSection
                    platform={platform}
                    targetVideoId={targetVideoId}
                    setTargetVideoId={setTargetVideoId}
                    forecastSeedVideoId={forecastSeedVideoId}
                    setForecastSeedVideoId={setForecastSeedVideoId}
                    beamWidth={beamWidth}
                    setBeamWidth={setBeamWidth}
                    forecast={forecast}
                    forecastError={forecastError}
                    isForecastLoading={isForecastLoading}
                    evaluation={evaluation}
                    isEvaluationLoading={isEvaluationLoading}
                    isBriefExporting={isBriefExporting}
                    briefExportMessage={briefExportMessage}
                    onSubmitForecast={submitForecast}
                    onExportBrief={exportGoToMarketBrief}
                    onViewCohortMap={(cohort) => {
                        const drillSeed = getForecastDrillSeed(seedVideoId);

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
