export interface PredictedReachPath {
    pathVideoIds: string[];
    probability: number;
    depth: number;
    platform: string;
    supportingTransitionWeight: number;
    edgeEvidence: Array<{
        fromVideoId: string;
        toVideoId: string;
        probability: number;
        support: number;
    }>;
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
    liftInterpretation: {
        isLiftInterpretable: boolean;
        gateReasons: string[];
        cohortTransitionSamples: number;
        exposureConfidenceIntervalWidth: number;
        adjacentWindowLiftDelta: number | null;
        adjacentWindowUsers: {
            earlier: number;
            later: number;
        } | null;
    };
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
    qualityGate: {
        status: 'ok' | 'degraded';
        parseCoverage: number;
        parserDropRate: number;
        minimumParseCoverage: number;
        maxParserDropRate: number;
        strictRecommendationRows: number;
        minimumStrictRecommendationRows: number;
        comparedUsers: number;
        minimumComparedUsers: number;
        cohortStabilityScore: number;
        minimumCohortStabilityScore: number;
        minimumCohortUsersForLift: number;
        canInterpretLift: boolean;
        reasonCodes: string[];
        degradationReasons: string[];
        confidenceMultiplier: number;
    };
    forecastReliability: {
        available: boolean;
        topK: number;
        globalReliabilityScore: number;
        globalSampleSize: number;
        globalHitRate: number;
        globalPrecisionAtK: number;
        globalCalibrationScore: number;
        globalGateStatus: 'pass' | 'degraded';
        globalGateReasons: string[];
        keyCohortGateStatus: 'pass' | 'degraded';
        keyCohortGateReasons: string[];
        keyCohorts: Array<{
            cohortId: string;
            reliabilityScore: number;
            sampleSize: number;
            gateStatus: 'pass' | 'degraded';
            gateReasons: string[];
        }>;
        adjacentWindowReliabilityDelta: number | null;
    };
    topCohorts: GoToMarketCohortBrief[];
    keyTakeaways: string[];
    markdown: string;
}
