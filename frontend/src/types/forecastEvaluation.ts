export interface TransitionEvaluationMetrics {
    topK: number;
    sampleSize: number;
    topKReachHitRate: number;
    precisionAtK: number;
    calibrationScore: number;
    reliabilityScore: number;
}

export interface CohortEvaluationMetrics extends TransitionEvaluationMetrics {
    cohortId: string;
    users: number;
    adjacentWindow: {
        earlierSampleSize: number;
        laterSampleSize: number;
        earlierReliabilityScore: number;
        laterReliabilityScore: number;
        reliabilityDelta: number | null;
    };
}

export interface ForecastEvaluationResult {
    platform: string;
    split: {
        trainSnapshots: number;
        testSnapshots: number;
        trainItems: number;
        testCases: number;
    };
    metrics: TransitionEvaluationMetrics;
    adjacentWindow: {
        earlierSampleSize: number;
        laterSampleSize: number;
        earlierReliabilityScore: number;
        laterReliabilityScore: number;
        reliabilityDelta: number | null;
    };
    cohortMetrics: CohortEvaluationMetrics[];
    validation: {
        globalGate: {
            status: 'pass' | 'degraded';
            reasons: string[];
            minimumSampleSize: number;
            minimumReliabilityScore: number;
            maximumAdjacentWindowReliabilityDelta: number;
        };
        keyCohortGate: {
            status: 'pass' | 'degraded';
            reasons: string[];
            minimumSampleSize: number;
            minimumReliabilityScore: number;
            maximumAdjacentWindowReliabilityDelta: number;
        };
        keyCohorts: Array<{
            cohortId: string;
            users: number;
            sampleSize: number;
            reliabilityScore: number;
            adjacentWindow: {
                earlierSampleSize: number;
                laterSampleSize: number;
                earlierReliabilityScore: number;
                laterReliabilityScore: number;
                reliabilityDelta: number | null;
            };
            gate: {
                status: 'pass' | 'degraded';
                reasons: string[];
                minimumSampleSize: number;
                minimumReliabilityScore: number;
                maximumAdjacentWindowReliabilityDelta: number;
            };
        }>;
    };
    generatedAt: string;
}
