1. **[P1] Reliability gate degradation does not actually gate cohort lift interpretation**
Confidence: High  
Evidence: [`applyReliabilityPenaltyToQualityGate` only sets `canInterpretLift = false` for unavailable reliability or `globalReliabilityScore < 0.35`](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/goToMarketBrief.ts:335), even when reliability gates are degraded for other reasons (`sample size`, `adjacent-window delta`, `key cohort gate`) ([`reliabilityNeedsDegrade` branch](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/goToMarketBrief.ts:341)). Forecast code gates lift strictly on `canInterpretLift` ([`qualityLiftGateActive`](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:1176), [`relativeLift` computation](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:1252)).  
Impact: System can report degraded reliability while still emitting interpretable lift (`relativeLiftVsGlobalExposure`) for unstable cohorts, which undermines the reliability gate contract.  
Fix: When `reliabilityNeedsDegrade` is true, force `canInterpretLift = false` (or gate it on all reliability gate statuses/reasons, not just global score).

2. **[P2] Key cohort reliability gate can pass with zero validated key cohorts**
Confidence: High  
Evidence: Test cases for unseen users get `cohortId = null` ([`snapshotsToEvaluationCases`](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/forecastEvaluation.ts:265)); `keyCohorts` is derived from `cohortMetrics` and may be empty ([construction](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/forecastEvaluation.ts:484)); gate status is `pass` whenever `degradedKeyCohorts.length === 0` ([gate logic](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/forecastEvaluation.ts:507)).  
Impact: A churn-heavy or adversarial dataset can produce “key cohort gate: pass” without any cohort-level validation evidence.  
Fix: Fail closed when `keyCohorts.length === 0` (or below a minimum), with explicit reason like “No key cohort holdout evidence.”

3. **[P2] Recommendation ID fallback prioritizes generic `id` before platform-native IDs**
Confidence: Medium-High  
Evidence: Candidate order checks generic fields first (`videoId`, `id`, `url`, `href`, `link`, `permalink`) before platform-native fields ([candidate list](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/recommendationParsing.ts:247)); resolver returns the first normalizable candidate ([first-hit return](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/recommendationParsing.ts:291)).  
Impact: Rows containing both a local/internal `id` and a true media identifier can be normalized to the wrong target, poisoning transitions and quality metrics.  
Fix: Reorder by platform-specific keys first, then URL/permalink extraction, and only then generic `id`; add ambiguity tests (e.g., TikTok `id` + `itemId`, Instagram `id` + `shortcode`).

4. **[P2] Adjacent-window lift stability evidence compares raw item IDs to unnormalized target**
Confidence: Medium  
Evidence: Stability evidence uses raw `item.videoId` via `sanitizeString` ([raw read](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:627)) and compares directly to `targetVideoId` sanitized only ([target normalization](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:599), [comparison](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:635)). Meanwhile model-building normalizes video IDs platform-aware ([normalization in model path](\/Users\/jonas\/Documents\/RESMA-main\/backend\/src\/services\/audienceForecast.ts:753)).  
Impact: URL-vs-canonical ID mismatches can undercount target exposure by window, yielding null/incorrect stability deltas and weakening lift stability gating.  
Fix: Normalize both `targetVideoId` and per-item IDs with the same platform-aware normalizer before window exposure comparisons.

I did not execute tests in this environment (read-only sandbox).
