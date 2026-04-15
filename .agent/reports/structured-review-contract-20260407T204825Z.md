1. **[P1] Active YouTube capture can be dropped when user stops capture mid-video**  
Confidence: **High**  
Evidence: `STOP_CAPTURE` only flips the flag and does not finalize/upload the active video: [youtube-observer.ts](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:133). Upload during finalize is now gated by `this.isManualCaptureActive`: [youtube-observer.ts](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:535).  
Impact: If a user clicks Stop while still on a playing video, that in-progress video is never uploaded, causing silent data loss for the session tail.  
Fix: In `STOP_CAPTURE`, call `finalizeActiveVideo()` before setting `isManualCaptureActive = false`, or add a `forceUpload` path in `finalizeActiveVideo()` used specifically for stop events.

2. **[P2] Instagram manual-session flush can become a no-op after lightweight uploads**  
Confidence: **Medium**  
Evidence: Lightweight uploads mark IDs as already uploaded: [instagram-observer.ts](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:379). Final manual flush excludes those same IDs: [instagram-observer.ts](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:388). It only emits `INSTAGRAM_MANUAL_CAPTURE` if remaining `feed.length > 0`: [instagram-observer.ts](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:391).  
Impact: A capture session can end without sending a manual-session terminal payload, which can break downstream logic that relies on explicit session-close events/metadata.  
Fix: Always emit a session-finalization event on stop (can contain zero new items), or separate dedupe of item uploads from session-boundary signaling.

3. **[P2] YouTube ingest type inference ignores recommendations present only in engagement metrics**  
Confidence: **High**  
Evidence: Recommendations are normalized from `item.recommendations ?? metrics.recommendations`: [youtube.ts](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts:225). But `hasWatchSignals` checks only `item.recommendations` (not `metrics.recommendations`): [youtube.ts](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts:284).  
Impact: Payloads carrying recommendations only under `engagementMetrics.recommendations` can be misclassified as `HOMEPAGE_SNAPSHOT` instead of `VIDEO_WATCH`, skewing analytics/segment logic.  
Fix: Update `hasWatchSignals` to include `metrics.recommendations` (or use already-normalized recommendation count).
