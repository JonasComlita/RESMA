# Adversarial Review (Working Tree)

1. **[P1][High] Non-idempotent retry path allows duplicate snapshot writes (replay + fallback amplification)**  
Refs: [service-worker.ts:379](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts:379), [service-worker.ts:409](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts:409), [ingestObservability.ts:17](/Users/jonas/Documents/RESMA-main/backend/src/services/ingestObservability.ts:17), [youtube.ts:298](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts:298), [feeds.ts:136](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:136).  
Repro: Send the same authenticated payload twice with identical `X-Resma-Upload-Id` (or trigger extension msgpack failure so it auto-falls back to JSON). Backend returns two `201` responses with different snapshot IDs and stores duplicates.  
Fix: Enforce idempotency server-side using `uploadId` (unique constraint like `(userId, platform, uploadId)` or dedicated ingest-events table with atomic upsert) and short-circuit duplicate uploads.

2. **[P2][High] `/feeds` now silently drops invalid feed items and still returns success (silent data corruption / false-success)**  
Refs: [feeds.ts:70](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:70), [feeds.ts:84](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:84), [index.ts:470](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:470).  
Repro: POST `/feeds` with `feed` containing one valid item and several malformed items (missing `videoId`). Request succeeds (`201`), but malformed rows are silently discarded and persisted snapshot is partial.  
Fix: Fail closed when any item fails coercion, or return `207`-style partial result with explicit rejected-row list; do not return full success on lossy ingestion.

3. **[P2][High] Single malformed metadata field collapses entire session metadata to `{ingestVersion}`**  
Refs: [index.ts:392](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:392), [index.ts:418](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:418), [index.ts:423](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:423).  
Repro: Submit valid feed plus `sessionMetadata: { type: {}, captureSurface: "home-feed-grid", clientSessionId: "abc" }`. Coercion fails parse and returns only `{ ingestVersion }`, silently dropping otherwise useful metadata.  
Fix: Build normalized metadata from a clean object (not `{...source}`), strip only invalid known keys, preserve valid fields, and surface validation errors instead of global metadata fallback.

4. **[P2][Medium] `go-to-market-brief` endpoint now performs heavy global holdout evaluation on every request (abuse/DoS vector)**  
Refs: [analysis.ts:147](/Users/jonas/Documents/RESMA-main/backend/src/routes/analysis.ts:147), [goToMarketBrief.ts:689](/Users/jonas/Documents/RESMA-main/backend/src/services/goToMarketBrief.ts:689), [forecastEvaluation.ts:376](/Users/jonas/Documents/RESMA-main/backend/src/services/forecastEvaluation.ts:376).  
Repro: Authenticated client repeatedly calls `/analysis/go-to-market-brief?...`; each request triggers `generateForecastEvaluation()` with up to 2000 snapshots + model/eval computation, causing avoidable DB/CPU load.  
Fix: Cache reliability summaries by platform/time window, precompute asynchronously, and apply per-user/IP rate limiting on this endpoint.
