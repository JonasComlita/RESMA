export interface DataQualityDiagnosticsResult {
    platform: string;
    windowHours: number;
    generatedAt: string;
    totals: {
        users: number;
        snapshots: number;
        feedItems: number;
        stitchedFeedItems: number;
        uniqueVideos: number;
    };
    stitching: {
        sessionGapMinutes: number;
        duplicateWindowSeconds: number;
        totalSnapshots: number;
        snapshotsAfterDedupe: number;
        dedupedSnapshots: number;
        duplicateRate: number;
        stitchedSessions: number;
        avgSnapshotsPerSession: number;
        snapshotsWithQualityFingerprint: number;
        snapshotsWithStitchedSessionKey: number;
    };
    recommendations: {
        itemsWithMetrics: number;
        decodableMetricItems: number;
        itemsWithRecommendationArray: number;
        rawRecommendationRows: number;
        strictRecommendationRows: number;
        parserDropRate: number;
        itemsWithParsedRecommendations: number;
        parseCoverage: number;
        strictRowCoverage: number;
        avgRecommendationsPerItem: number;
        surfaceTransitionStability: number;
        bySurface: Array<{
            surface: string;
            rawRows: number;
            strictRows: number;
            parserDropRate: number;
            parseCoverage: number;
            uniqueTransitions: number;
            transitionStabilityScore: number;
        }>;
    };
    cohorts: {
        eligibleUsers: number;
        lowDataUsers: number;
        cohortCount: number;
        smallCohortCount: number;
        smallCohortUserShare: number;
        stabilityScore: number;
        networkStrength: number;
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
}

export interface DataQualityTrendPoint {
    windowStart: string;
    windowEnd: string;
    users: number;
    snapshots: number;
    stitchedSessions: number;
    dedupedSnapshots: number;
    dedupeRate: number;
    parseCoverage: number;
    strictRecommendationRows: number;
    parserDropRate: number;
    cohortStabilityScore: number;
    networkStrength: number;
    qualityGateStatus: 'ok' | 'degraded';
    qualityGateReasons: string[];
    surfaceMetrics: Array<{
        surface: string;
        rawRows: number;
        strictRows: number;
        parserDropRate: number;
        parseCoverage: number;
        transitionStabilityScore: number;
    }>;
}

export interface DataQualityTrendResult {
    platform: string;
    windowHours: number;
    bucketHours: number;
    generatedAt: string;
    points: DataQualityTrendPoint[];
    drift: {
        status: 'stable' | 'warning' | 'critical';
        parseCoverageDelta: number;
        parserDropRateDelta: number;
        strictRowsDelta: number;
        dedupeRateDelta: number;
        cohortStabilityDelta: number;
        reasons: string[];
    };
}
