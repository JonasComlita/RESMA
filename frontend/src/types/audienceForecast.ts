export interface CohortAudienceForecast {
    cohortId: string;
    cohortLabel: string;
    users: number;
    fitScore: number;
    targetExposureRate: number;
    exposureConfidenceInterval: {
        low: number;
        high: number;
    };
    directProbabilityFromSeed: number | null;
    reachProbabilityFromSeed: number | null;
    relativeLiftVsGlobalExposure: number | null;
    score: number;
}

export interface AudienceForecastResult {
    platform: string;
    targetVideoId: string;
    seedVideoId: string | null;
    settings: {
        maxDepth: number;
        beamWidth: number;
    };
    networkEffect: {
        comparedUsers: number;
        comparedFeedItems: number;
        comparedTransitions: number;
        pairwiseComparisons: number;
        cohortCount: number;
        networkStrength: number;
    };
    global: {
        targetExposureRate: number;
        targetExposureConfidenceInterval: {
            low: number;
            high: number;
        };
        directProbabilityFromSeed: number | null;
        reachProbabilityFromSeed: number | null;
    };
    qualityGate: {
        status: 'ok' | 'degraded';
        parseCoverage: number;
        parserDropRate: number;
        minimumParseCoverage: number;
        confidenceMultiplier: number;
    };
    recommendedAudienceCohorts: CohortAudienceForecast[];
    cohorts: CohortAudienceForecast[];
}
