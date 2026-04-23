import { useState } from 'react';
import { api } from '../services/api';
import type { AudienceForecastResult } from '../types/audienceForecast';
import type { ForecastEvaluationResult } from '../types/forecastEvaluation';
import type { GoToMarketBriefResult } from '../types/goToMarketBrief';

function downloadTextFile(filename: string, content: string, mimeType = 'text/markdown;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function useDashboardForecast(platform: string, maxDepth: number) {
    const [targetVideoId, setTargetVideoId] = useState('');
    const [forecastSeedVideoId, setForecastSeedVideoId] = useState('');
    const [beamWidth, setBeamWidth] = useState(30);
    const [forecast, setForecast] = useState<AudienceForecastResult | null>(null);
    const [forecastError, setForecastError] = useState<string | null>(null);
    const [isForecastLoading, setIsForecastLoading] = useState(false);
    const [evaluation, setEvaluation] = useState<ForecastEvaluationResult | null>(null);
    const [isEvaluationLoading, setIsEvaluationLoading] = useState(false);
    const [isBriefExporting, setIsBriefExporting] = useState(false);
    const [briefExportMessage, setBriefExportMessage] = useState<string | null>(null);

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

    const submitForecast = () => {
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
                const filename = `aggregate-insight-brief-${brief.platform}-${brief.targetVideoId}-${dateStamp}.md`;
                downloadTextFile(filename, brief.markdown);
                setBriefExportMessage(`Brief exported: ${filename}`);
            })
            .catch((error: Error) => {
                setBriefExportMessage(error.message || 'Unable to export the aggregate insight brief.');
            })
            .finally(() => setIsBriefExporting(false));
    };

    const getForecastDrillSeed = (mapSeedVideoId: string) => (
        mapSeedVideoId.trim()
        || forecastSeedVideoId.trim()
        || targetVideoId.trim()
    );

    return {
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
    };
}
