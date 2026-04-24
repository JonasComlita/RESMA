export interface OppositeDiscoveryBubbleSummary {
    score: number;
    level: 'low' | 'medium' | 'high';
    dominantCategory: string;
    diversityBand: 'low' | 'medium' | 'high';
    loyaltyBand: 'low' | 'medium' | 'high';
    topCategoryShare: number;
    topCreatorShare: number;
    explanations: string[];
}

export interface OppositeDiscoveryCurrentCohort {
    cohortId: string;
    cohortLabel: string;
    users: number;
    materialized: boolean;
}

export interface OppositeDiscoveryCohort {
    cohortId: string;
    cohortLabel: string;
    users: number;
    distanceScore: number;
    dominantCategory: string;
    diversityBand: 'low' | 'medium' | 'high';
    loyaltyBand: 'low' | 'medium' | 'high';
    videoOverlap: number;
    transitionOverlap: number;
    whyFar: string[];
}

export interface OppositeDiscoveryCandidate {
    videoId: string;
    sourceCohortId: string;
    sourceCohortLabel: string;
    cohortExposureRate: number;
    currentCohortExposureRate: number;
    underexposureLift: number;
    distanceScore: number;
    score: number;
    explanations: string[];
}

export interface OppositeDiscoveryBridgeContent {
    videoId: string;
    sourceCohortId: string;
    sourceCohortLabel: string;
    pathSeeds: string[];
    bestPath: string[];
    pathReachProbability: number;
    underexposureLift: number;
    distanceScore: number;
    score: number;
    label: string;
}

export interface OppositeDiscoveryResult {
    platform: string;
    bubble: OppositeDiscoveryBubbleSummary;
    currentCohort: OppositeDiscoveryCurrentCohort;
    oppositeCohorts: OppositeDiscoveryCohort[];
    candidates: OppositeDiscoveryCandidate[];
    bridgeContent: OppositeDiscoveryBridgeContent[];
    diversityGap: {
        dominantCategoryShare: number;
        outsideCurrentCohortCandidateCount: number;
        bridgeCandidateCount: number;
        distantCohortCount: number;
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
}
