import { useState } from 'react';
import { api } from '../services/api';
import type { RecommendationMapResult } from '../types/recommendationMap';

export function useDashboardRecommendationMap(platform: string, maxDepth: number) {
    const [seedVideoId, setSeedVideoId] = useState('');
    const [maxNodes, setMaxNodes] = useState(60);
    const [mapResult, setMapResult] = useState<RecommendationMapResult | null>(null);
    const [mapError, setMapError] = useState<string | null>(null);
    const [isMapLoading, setIsMapLoading] = useState(false);
    const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
    const [selectedCohortLabel, setSelectedCohortLabel] = useState<string | null>(null);

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

    const resetToContributorScope = () => {
        setSelectedCohortId(null);
        setSelectedCohortLabel(null);

        if (seedVideoId.trim()) {
            loadRecommendationMap({ seed: seedVideoId.trim() });
        }
    };

    return {
        seedVideoId,
        setSeedVideoId,
        maxNodes,
        setMaxNodes,
        mapResult,
        mapError,
        isMapLoading,
        selectedCohortId,
        selectedCohortLabel,
        setMapError,
        loadRecommendationMap,
        resetToContributorScope,
    };
}
