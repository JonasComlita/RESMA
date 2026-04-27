import type { PlatformFeedPayload } from '@resma/shared';

export interface NumericRange {
    min: number;
    max: number;
}

export type SupportedHeadlessPlatform = 'youtube';
export type ResearchMode = 'synthetic-logged-out' | 'research-account';
export type CaptureIdentity = 'signed-out-synthetic' | 'signed-in-research-account';
export type GovernedResearchAccountStatus = 'active' | 'paused' | 'retired';
export type GovernedResearchAccountRunScope = 'local-manual-only' | 'orchestrated';
export type GovernedResearchAllowedCaptureMode = 'passive-observation-only';
export type GovernedResearchCredentialSourceKind = 'persistent-user-data-dir';

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
    platform: SupportedHeadlessPlatform;
    researchMode: 'synthetic-logged-out';
    region: RegionDefinition;
    category: CategoryDefinition;
    behavior: BehavioralTraitDefinition;
    notes: string[];
}

export interface GovernedResearchAccountOwner {
    operatorId?: string;
    displayName?: string;
    teamName?: string;
}

export interface GovernedResearchCredentialSource {
    kind: GovernedResearchCredentialSourceKind;
    reference: string;
    path: string;
}

export interface GovernedResearchAccount {
    id: string;
    label: string;
    platform: SupportedHeadlessPlatform;
    researchPurpose: string;
    notes: string[];
    allowedCaptureMode: GovernedResearchAllowedCaptureMode;
    credentialSource: GovernedResearchCredentialSource;
    status: GovernedResearchAccountStatus;
    owner?: GovernedResearchAccountOwner;
    runScope: GovernedResearchAccountRunScope;
}

export interface GovernedResearchAccountConfig {
    version: 1;
    accounts: GovernedResearchAccount[];
}

export interface GovernedResearchAccountReference {
    id: string;
    label: string;
    platform: SupportedHeadlessPlatform;
    researchPurpose: string;
    notes: string[];
    allowedCaptureMode: GovernedResearchAllowedCaptureMode;
    status: GovernedResearchAccountStatus;
    runScope: GovernedResearchAccountRunScope;
    owner?: GovernedResearchAccountOwner;
    credentialSourceReference: string;
}

export interface CaptureModeContext {
    mode: ResearchMode;
    captureIdentity: CaptureIdentity;
    researchAccount?: GovernedResearchAccountReference;
}

export interface CaptureRuntimeOptions {
    apiBaseUrl?: string;
    authToken?: string;
    browserChannel?: string;
    captureMode?: CaptureModeContext;
    headless?: boolean;
    outputDir: string;
    profileStorageDir: string;
    profileTimeoutMs?: number;
    researchAccount?: GovernedResearchAccount;
    resumeExisting?: boolean;
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
    captureMode: CaptureModeContext;
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
    resumedCount: number;
    uploadAttemptCount: number;
    uploadSuccessCount: number;
    lowRecommendationProfiles: string[];
    lowSearchResultProfiles: string[];
    missingCoverageCells: CoverageCellSummary[];
    coverageCells: CoverageCellSummary[];
}

export interface CaptureRunResult {
    completed: PersistedCaptureArtifact[];
    resumed: PersistedCaptureArtifact[];
    failed: Array<{ profileId: string; error: string }>;
    summary: CaptureRunSummary;
    summaryPath: string;
}
