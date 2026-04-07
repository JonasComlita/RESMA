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
    cohortMetrics: CohortEvaluationMetrics[];
    generatedAt: string;
}

