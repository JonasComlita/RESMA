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
    stabilityConstraints: {
        minimumCohortUsersForLift: number;
        minimumCohortTransitionSamplesForLift: number;
        maximumExposureConfidenceIntervalWidthForLift: number;
        minimumAdjacentWindowUsersForLiftStability: number;
        maximumAdjacentWindowLiftDelta: number;
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
        metadataIntegrityScore: number;
        minimumMetadataIntegrityScore: number;
        snapshotsWithMetadata: number;
        decodedMetadataSnapshots: number;
        invalidMetadataSnapshots: number;
        minimumCohortUsersForLift: number;
        canInterpretLift: boolean;
        reasonCodes: string[];
        degradationReasons: string[];
        confidenceMultiplier: number;
    };
    recommendedAudienceCohorts: CohortAudienceForecast[];
    cohorts: CohortAudienceForecast[];
}
