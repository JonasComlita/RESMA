1. **[P2] (High)** Per-surface parse metrics can be mathematically invalid because raw and strict surfaces are normalized differently.  
Evidence: raw rows are bucketed with `normalizeSurfaceLabel(rec.surface ?? rec.source ?? rec.placement)` in [dataQuality.ts:446](/Users/jonas/Documents/RESMA-main/backend/src/services/dataQuality.ts:446), while strict rows use parser-normalized/aliased surfaces in [dataQuality.ts:465](/Users/jonas/Documents/RESMA-main/backend/src/services/dataQuality.ts:465), driven by alias remapping in [recommendationParsing.ts:68](/Users/jonas/Documents/RESMA-main/backend/src/services/recommendationParsing.ts:68) and [recommendationParsing.ts:108](/Users/jonas/Documents/RESMA-main/backend/src/services/recommendationParsing.ts:108).  
Impact: `bySurface.parseCoverage` can exceed `1` and `bySurface.parserDropRate` can go negative for canonicalized surfaces, which corrupts data-quality diagnostics and any downstream alerting/charting.  
Concrete fix: use the same surface normalization path for raw and strict rows (platform-aware aliasing + same field precedence, including `origin`), then clamp per-surface coverage/drop to `[0,1]` as a safety net.

2. **[P2] (Medium)** Trend drift logic compares absolute strict-row counts across buckets, which confounds data volume with data quality.  
Evidence: drift uses `strictRowsDelta = latest.strictRecommendationRows - previous.strictRecommendationRows` in [dataQuality.ts:796](/Users/jonas/Documents/RESMA-main/backend/src/services/dataQuality.ts:796) and triggers warnings/critical thresholds directly from that absolute delta in [dataQuality.ts:817](/Users/jonas/Documents/RESMA-main/backend/src/services/dataQuality.ts:817).  
Impact: normal traffic/snapshot fluctuations between buckets can produce false degradation (`warning`/`critical`) even when parser quality is stable.  
Concrete fix: compare normalized rates (for example strict rows per stitched session or per snapshot), or gate absolute-delta checks behind a minimum volume-similarity condition between adjacent buckets.

3. **[P3] (High)** One YouTube surface alias is unreachable due key normalization mismatch.  
Evidence: alias lookup strips `-`/`_` (`aliasKey`) in [recommendationParsing.ts:108](/Users/jonas/Documents/RESMA-main/backend/src/services/recommendationParsing.ts:108), but map contains `'shorts-feed'` in [recommendationParsing.ts:77](/Users/jonas/Documents/RESMA-main/backend/src/services/recommendationParsing.ts:77), which will never match (`shortsfeed` is expected).  
Impact: `'shorts-feed'` labels fail to canonicalize to `'shorts-overlay'`, fragmenting surface stats.  
Concrete fix: change alias key to `shortsfeed` (and ensure all alias keys are in post-normalization form), or change lookup to use the same canonical key format as the map.

Validation note: I could not run Vitest in this environment because the sandbox is read-only and test execution failed with EPERM when creating temp/cache files.
