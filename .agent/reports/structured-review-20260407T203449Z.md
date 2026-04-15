# Structured Review (Working Tree)

1. **[P2] (High)** Silent partial-ingest acceptance in `/feeds` can hide malformed payload rows and corrupt data completeness.  
Evidence: [`backend/src/routes/feeds.ts:71`](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:71) now accepts any payload that `coercePlatformFeedPayload` returns; [`packages/shared/src/index.ts:470`](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:470) drops invalid feed items via `.filter(Boolean)` and still returns success if at least one item remains. The prior `/feeds` path rejected on first invalid item.  
Impact: Producers can send partially bad batches and still get `201`, causing silent row loss and biased downstream analytics/quality metrics.  
Fix: Enforce strict row preservation for this endpoint (reject when coerced count `<` raw count), or at minimum return/record dropped-row counts and fail above a small threshold.

2. **[P2] (Medium)** YouTube category extraction regresses for legacy payloads that send `tags`.  
Evidence: [`backend/src/routes/youtube.ts:258`](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts:258) now only reads `item.contentCategories`; shared coercion maps legacy `tags` into `contentTags` instead ([`packages/shared/src/index.ts:360`](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:360)).  
Impact: Existing clients still sending `tags` will lose category signals in persisted `contentCategories`, reducing cohorting/insight quality.  
Fix: In YouTube ingest, fallback to `contentTags`/`tags` when `contentCategories` is empty, or map `tags -> contentCategories` in shared coercion for YouTube.

3. **[P2] (High)** Go-to-market reliability gating ignores computed evaluation gates and drops adjacent-window drift signal.  
Evidence: `generateForecastEvaluation` provides `validation.globalGate`, `validation.keyCohortGate`, and `adjacentWindow.reliabilityDelta` ([`backend/src/services/forecastEvaluation.ts:527`](/Users/jonas/Documents/RESMA-main/backend/src/services/forecastEvaluation.ts:527)); `deriveBriefReliabilitySummary` re-derives different gates and hardcodes `adjacentWindowReliabilityDelta: null` ([`backend/src/services/goToMarketBrief.ts:301`](/Users/jonas/Documents/RESMA-main/backend/src/services/goToMarketBrief.ts:301), [`backend/src/services/goToMarketBrief.ts:351`](/Users/jonas/Documents/RESMA-main/backend/src/services/goToMarketBrief.ts:351)).  
Impact: Brief confidence penalties can be incorrect (false pass/fail), and temporal instability is never surfaced in output despite being computed.  
Fix: Consume `evaluation.validation.*` directly and propagate `evaluation.adjacentWindow.reliabilityDelta` into `BriefReliabilitySummary`.

4. **[P3] (Medium)** Happy-path YouTube ingest test coverage was removed, leaving high-risk ingestion changes unguarded.  
Evidence: [`backend/tests/youtube-feed.test.ts:29`](/Users/jonas/Documents/RESMA-main/backend/tests/youtube-feed.test.ts:29) now only checks auth/invalid payload failure paths; no `201` success-path assertion remains.  
Impact: Regressions in write-path behavior (contract coercion, replay handling, metadata persistence) can ship without detection.  
Fix: Add a successful `/youtube/feed` integration test (with mocked Prisma or test DB) asserting persisted snapshot/item count and expected metadata fields.
