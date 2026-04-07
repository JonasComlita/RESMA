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
}

export interface DataQualityTrendPoint {
    windowStart: string;
    windowEnd: string;
    users: number;
    snapshots: number;
    stitchedSessions: number;
    dedupeRate: number;
    parseCoverage: number;
    parserDropRate: number;
    cohortStabilityScore: number;
    networkStrength: number;
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
}
