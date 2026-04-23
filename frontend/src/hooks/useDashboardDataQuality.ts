import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { DataQualityDiagnosticsResult, DataQualityTrendResult } from '../types/dataQuality';

export const DEFAULT_QUALITY_WINDOW_HOURS = 24 * 14;
export const DEFAULT_QUALITY_TREND_BUCKET_HOURS = 24;
const QUALITY_THRESHOLDS_STORAGE_KEY = 'resmaDataQualityThresholdsV1';

export const QUALITY_WINDOW_OPTIONS = [
    { label: '7d', hours: 24 * 7 },
    { label: '14d', hours: 24 * 14 },
    { label: '30d', hours: 24 * 30 },
    { label: '60d', hours: 24 * 60 },
    { label: '90d', hours: 24 * 90 },
];

export const QUALITY_BUCKET_OPTIONS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
];

export const SURFACE_TREND_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed'];

export type SurfaceTrendMetric = 'parseCoverage' | 'parserDropRate' | 'transitionStabilityScore';

export const SURFACE_TREND_METRIC_OPTIONS: Array<{ id: SurfaceTrendMetric; label: string }> = [
    { id: 'parseCoverage', label: 'Parse Coverage %' },
    { id: 'parserDropRate', label: 'Parser Drop %' },
    { id: 'transitionStabilityScore', label: 'Transition Stability %' },
];

export interface QualityThresholds {
    parserDropWarn: number;
    parserDropCritical: number;
    stabilityWarn: number;
    stabilityCritical: number;
    fingerprintCoverageWarn: number;
    surfaceParserDropWarn: number;
    surfaceParserDropCritical: number;
    surfaceStabilityWarn: number;
    surfaceStabilityCritical: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
    parserDropWarn: 0.3,
    parserDropCritical: 0.5,
    stabilityWarn: 0.75,
    stabilityCritical: 0.6,
    fingerprintCoverageWarn: 0.6,
    surfaceParserDropWarn: 0.4,
    surfaceParserDropCritical: 0.6,
    surfaceStabilityWarn: 0.25,
    surfaceStabilityCritical: 0.12,
};

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const clampedP = Math.max(0, Math.min(1, p));
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.round((sorted.length - 1) * clampedP))
    );
    return sorted[index];
}

function clampUnit(value: number) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeThresholds(input: QualityThresholds): QualityThresholds {
    const parserDropWarn = clampUnit(input.parserDropWarn);
    const parserDropCritical = Math.max(parserDropWarn, clampUnit(input.parserDropCritical));
    const stabilityCritical = clampUnit(input.stabilityCritical);
    const stabilityWarn = Math.max(stabilityCritical, clampUnit(input.stabilityWarn));
    const surfaceParserDropWarn = clampUnit(input.surfaceParserDropWarn);
    const surfaceParserDropCritical = Math.max(surfaceParserDropWarn, clampUnit(input.surfaceParserDropCritical));
    const surfaceStabilityCritical = clampUnit(input.surfaceStabilityCritical);
    const surfaceStabilityWarn = Math.max(surfaceStabilityCritical, clampUnit(input.surfaceStabilityWarn));

    return {
        parserDropWarn,
        parserDropCritical,
        stabilityWarn,
        stabilityCritical,
        fingerprintCoverageWarn: clampUnit(input.fingerprintCoverageWarn),
        surfaceParserDropWarn,
        surfaceParserDropCritical,
        surfaceStabilityWarn,
        surfaceStabilityCritical,
    };
}

export function useDashboardDataQuality(userPresent: boolean, platform: string) {
    const [dataQuality, setDataQuality] = useState<DataQualityDiagnosticsResult | null>(null);
    const [dataQualityTrend, setDataQualityTrend] = useState<DataQualityTrendResult | null>(null);
    const [dataQualityError, setDataQualityError] = useState<string | null>(null);
    const [isDataQualityLoading, setIsDataQualityLoading] = useState(false);
    const [qualityWindowHours, setQualityWindowHours] = useState(DEFAULT_QUALITY_WINDOW_HOURS);
    const [qualityBucketHours, setQualityBucketHours] = useState(DEFAULT_QUALITY_TREND_BUCKET_HOURS);
    const [qualityThresholds, setQualityThresholds] = useState<QualityThresholds>(DEFAULT_QUALITY_THRESHOLDS);
    const [surfaceTrendMetric, setSurfaceTrendMetric] = useState<SurfaceTrendMetric>('parseCoverage');

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

    useEffect(() => {
        if (userPresent) {
            loadDataQuality({
                targetPlatform: platform,
                windowHours: qualityWindowHours,
                bucketHours: qualityBucketHours,
                keepExisting: true,
            });
        }
    }, [userPresent, platform, qualityWindowHours, qualityBucketHours]);

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
                surfaceParserDropWarn: typeof parsed.surfaceParserDropWarn === 'number'
                    ? parsed.surfaceParserDropWarn
                    : current.surfaceParserDropWarn,
                surfaceParserDropCritical: typeof parsed.surfaceParserDropCritical === 'number'
                    ? parsed.surfaceParserDropCritical
                    : current.surfaceParserDropCritical,
                surfaceStabilityWarn: typeof parsed.surfaceStabilityWarn === 'number'
                    ? parsed.surfaceStabilityWarn
                    : current.surfaceStabilityWarn,
                surfaceStabilityCritical: typeof parsed.surfaceStabilityCritical === 'number'
                    ? parsed.surfaceStabilityCritical
                    : current.surfaceStabilityCritical,
            }));
        } catch {
            // Ignore malformed local storage payloads.
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(QUALITY_THRESHOLDS_STORAGE_KEY, JSON.stringify(qualityThresholds));
    }, [qualityThresholds]);

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
        const surfaceParserSeries = dataQualityTrend.points
            .flatMap((point) => point.surfaceMetrics.map((surface) => surface.parserDropRate))
            .filter((value) => Number.isFinite(value));
        const surfaceStabilitySeries = dataQualityTrend.points
            .flatMap((point) => point.surfaceMetrics.map((surface) => surface.transitionStabilityScore))
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
            surfaceParserDropWarn: surfaceParserSeries.length > 0
                ? clampUnit(percentile(surfaceParserSeries, 0.75) + 0.02)
                : DEFAULT_QUALITY_THRESHOLDS.surfaceParserDropWarn,
            surfaceParserDropCritical: surfaceParserSeries.length > 0
                ? clampUnit(percentile(surfaceParserSeries, 0.9) + 0.04)
                : DEFAULT_QUALITY_THRESHOLDS.surfaceParserDropCritical,
            surfaceStabilityWarn: surfaceStabilitySeries.length > 0
                ? clampUnit(percentile(surfaceStabilitySeries, 0.25) - 0.01)
                : DEFAULT_QUALITY_THRESHOLDS.surfaceStabilityWarn,
            surfaceStabilityCritical: surfaceStabilitySeries.length > 0
                ? clampUnit(percentile(surfaceStabilitySeries, 0.1) - 0.02)
                : DEFAULT_QUALITY_THRESHOLDS.surfaceStabilityCritical,
        });

        setQualityThresholds(tuned);
    };

    const surfaceTrendLeaders = useMemo(() => {
        if (!dataQualityTrend || dataQualityTrend.points.length === 0) return [];
        const strictRowsBySurface = new Map<string, number>();

        for (const point of dataQualityTrend.points) {
            const surfaceMetrics = Array.isArray(point.surfaceMetrics) ? point.surfaceMetrics : [];
            for (const surface of surfaceMetrics) {
                strictRowsBySurface.set(
                    surface.surface,
                    (strictRowsBySurface.get(surface.surface) ?? 0) + surface.strictRows
                );
            }
        }

        return Array.from(strictRowsBySurface.entries())
            .filter(([, strictRows]) => strictRows > 0)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 4)
            .map(([surface]) => surface);
    }, [dataQualityTrend]);

    const surfaceTrendSeries = useMemo(() => {
        if (!dataQualityTrend || dataQualityTrend.points.length === 0 || surfaceTrendLeaders.length === 0) {
            return [];
        }

        return dataQualityTrend.points.map((point) => {
            const row: Record<string, string | number | null> = {
                time: new Date(point.windowStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            };

            for (const surface of surfaceTrendLeaders) {
                const pointSurfaces = Array.isArray(point.surfaceMetrics) ? point.surfaceMetrics : [];
                const surfaceMetrics = pointSurfaces.find((entry) => entry.surface === surface);
                const value = surfaceMetrics ? surfaceMetrics[surfaceTrendMetric] : null;
                row[`surface:${surface}`] = typeof value === 'number'
                    ? Math.round(value * 100)
                    : null;
            }

            return row;
        });
    }, [dataQualityTrend, surfaceTrendLeaders, surfaceTrendMetric]);

    return {
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
    };
}
