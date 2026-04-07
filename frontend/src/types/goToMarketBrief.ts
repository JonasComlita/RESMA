export interface PredictedReachPath {
    pathVideoIds: string[];
    probability: number;
    depth: number;
}

export interface GoToMarketCohortBrief {
    cohortId: string;
    cohortLabel: string;
    users: number;
    targetExposureRate: number;
    exposureConfidenceInterval: {
        low: number;
        high: number;
    };
    relativeLiftVsGlobalExposure: number | null;
    directProbabilityFromSeed: number | null;
    reachProbabilityFromSeed: number | null;
    fitScore: number;
    score: number;
    predictedReachPaths: PredictedReachPath[];
}

export interface GoToMarketBriefResult {
    generatedAt: string;
    platform: string;
    targetVideoId: string;
    seedVideoId: string | null;
    settings: {
        maxDepth: number;
        beamWidth: number;
        topCohorts: number;
        maxPathsPerCohort: number;
        pathBranchLimit: number;
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
    topCohorts: GoToMarketCohortBrief[];
    keyTakeaways: string[];
    markdown: string;
}

