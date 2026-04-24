import type { PlatformFeedPayload } from '@resma/shared';

export interface NumericRange {
    min: number;
    max: number;
}

export interface RegionDefinition {
    key: string;
    displayName: string;
    youtubeRegionCode: string;
    locale: string;
    timezoneId: string;
    acceptLanguage: string;
}

export interface CategoryDefinition {
    key: string;
    label: string;
    description: string;
    querySeeds: string[];
    followUpQuerySeeds: string[];
}

export type RevisitPattern = 'none' | 'same-query' | 'adjacent-query' | 'channel-loop';

export interface BehavioralTraitDefinition {
    key: string;
    label: string;
    description: string;
    watchDurationSeconds: NumericRange;
    watchDurationRatio: NumericRange;
    scrollCadenceMs: NumericRange;
    interactionRate: NumericRange;
    sessionLengthActions: NumericRange;
    detailOpenRate: NumericRange;
    revisitPattern: RevisitPattern;
    revisitProbability: number;
}

export interface SyntheticResearchProfile {
    id: string;
    storageKey: string;
    platform: 'youtube';
    researchMode: 'synthetic-logged-out';
    region: RegionDefinition;
    category: CategoryDefinition;
    behavior: BehavioralTraitDefinition;
    notes: string[];
}

export interface CaptureRuntimeOptions {
    apiBaseUrl?: string;
    authToken?: string;
    browserChannel?: string;
    headless?: boolean;
    outputDir: string;
    profileStorageDir: string;
    upload?: boolean;
}

export interface CapturedItemCandidate {
    videoId: string;
    title: string | null;
    channel: string | null;
    url: string;
    position: number;
    captureSurface: string;
    viewCountText: string | null;
}

export interface ProfileCaptureSummary {
    homeItemCount: number;
    searchItemCount: number;
    recommendationCount: number;
    interactedVideoId: string | null;
    query: string;
    followUpQuery: string | null;
    revisitPatternApplied: RevisitPattern | 'skipped';
}

export interface CaptureArtifact {
    profile: SyntheticResearchProfile;
    payload: PlatformFeedPayload;
    summary: ProfileCaptureSummary;
    warnings: string[];
}

export interface UploadResult {
    endpoint: string;
    ok: boolean;
    status: number;
    uploadId: string;
    body: unknown;
}

export interface PersistedCaptureArtifact extends CaptureArtifact {
    artifactPath: string;
    upload: UploadResult | null;
}

export interface CoverageCellSummary {
    regionKey: string;
    categoryKey: string;
    count: number;
}

export interface CaptureRunSummary {
    totalProfilesRequested: number;
    completedCount: number;
    failedCount: number;
    uploadAttemptCount: number;
    uploadSuccessCount: number;
    lowRecommendationProfiles: string[];
    lowSearchResultProfiles: string[];
    missingCoverageCells: CoverageCellSummary[];
    coverageCells: CoverageCellSummary[];
}

export interface CaptureRunResult {
    completed: PersistedCaptureArtifact[];
    failed: Array<{ profileId: string; error: string }>;
    summary: CaptureRunSummary;
    summaryPath: string;
}
