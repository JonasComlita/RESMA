export {
    BEHAVIORAL_TRAITS,
    buildSyntheticProfiles,
    CORE_CATEGORY_DEFINITIONS,
    getBehaviorByKey,
    getCategoryByKey,
    getRegionByKey,
    pickFollowUpQuery,
    pickSeedQuery,
    RESEARCH_REGIONS,
} from './profiles.js';
export { runSyntheticCaptureMatrix, summarizeCaptureRun } from './orchestrator.js';
export { captureYouTubeProfile } from './youtube.js';
export { uploadCapturePayload } from './uploader.js';
export type {
    BehavioralTraitDefinition,
    CaptureArtifact,
    CaptureRunResult,
    CaptureRunSummary,
    CaptureRuntimeOptions,
    CategoryDefinition,
    CoverageCellSummary,
    PersistedCaptureArtifact,
    ProfileCaptureSummary,
    RegionDefinition,
    SyntheticResearchProfile,
    UploadResult,
} from './types.js';
