1. **[P0] Consent/collection mismatch: extension uploads feed data even when capture is not started**  
Confidence: **High**  
Evidence: Privacy copy says no data is collected unless user starts a session in [extension/src/popup/Popup.tsx:160](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx:160), but YouTube auto-snapshots on init in [extension/src/content/youtube-observer.ts:93](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:93) and uploads in [extension/src/content/youtube-observer.ts:218](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:218); Instagram auto-flushes every 12s in [extension/src/content/instagram-observer.ts:99](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:99) and uploads in [extension/src/content/instagram-observer.ts:364](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:364), regardless of `isCapturing`.  
Impact: Potential legal/compliance and trust issue due collection behavior contradicting explicit UI claim.  
Fix: Either gate all uploads behind explicit opt-in (`isCapturing`) or update UI/privacy language to reflect automatic collection behavior.

2. **[P1] Twitter path appears partially supported in UI/shared schema but routes as TikTok payload shape**  
Confidence: **Medium**  
Evidence: `twitter` is still a supported platform in shared schema [packages/shared/src/index.ts:3](/Users/jonas/Documents/RESMA-main/packages/shared/src/index.ts:3) and popup still exposes Twitter flow [extension/src/popup/Popup.tsx:11](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx:11), [extension/src/popup/Popup.tsx:38](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx:38). Service worker’s local `SupportedPlatform` excludes twitter [extension/src/background/service-worker.ts:9](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts:9), non-YouTube/Instagram endpoints go to `/feeds` [extension/src/background/service-worker.ts:314](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts:314), and non-TikTok payloads omit `platform` [extension/src/background/service-worker.ts:329](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts:329). `/feeds` defaults missing platform to TikTok [backend/src/routes/feeds.ts:72](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:72).  
Impact: If any Twitter payload reaches this path, data can be misclassified as TikTok and stored with wrong metadata.  
Fix: Decide explicitly: remove Twitter from UI/schema now, or add full end-to-end Twitter support (service worker type, endpoint routing, payload shaping, backend route).

3. **[P2] Re-watching same YouTube video ID can corrupt session entry updates**  
Confidence: **High**  
Evidence: New entries are appended per track start [extension/src/content/youtube-observer.ts:275](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:275), but active lookup uses `find` by `videoId` [extension/src/content/youtube-observer.ts:557](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts:557), which returns the first matching historical entry.  
Impact: Watch time/seek/ad/recommendation updates can apply to an older entry when the same video is revisited, producing inaccurate telemetry uploads.  
Fix: Track active entry by unique per-watch key (or array index/reference), not by `videoId` alone.

4. **[P2] Unhandled metadata parse can 500 feed read endpoints**  
Confidence: **High**  
Evidence: Legacy JSON fallback parse is unguarded in [backend/src/routes/feeds.ts:35](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:35), and used in response transforms [backend/src/routes/feeds.ts:44](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:44), [backend/src/routes/feeds.ts:235](/Users/jonas/Documents/RESMA-main/backend/src/routes/feeds.ts:235).  
Impact: Any malformed/legacy corrupted metadata blob can crash snapshot list/detail reads with 500.  
Fix: Wrap JSON parse/decompression in try/catch, log the decode failure, and return `null`/safe fallback per field.

5. **[P2] Popup production links are hardcoded to localhost**  
Confidence: **High**  
Evidence: Login and dashboard links are fixed to localhost in [extension/src/popup/Popup.tsx:166](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx:166) and [extension/src/popup/Popup.tsx:243](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx:243).  
Impact: Production extension can direct users to non-functional local URLs, breaking auth/onboarding flow.  
Fix: Source web app base URL from env/config (same pattern as service worker API base), with explicit prod/dev defaults.

6. **[P3] Instagram stop-capture can double-upload the final reel**  
Confidence: **Medium**  
Evidence: `STOP_CAPTURE` calls `finalizeReel()` then `flushManualCaptureSession()` [extension/src/content/instagram-observer.ts:76](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:76). `finalizeReel()` uploads immediately [extension/src/content/instagram-observer.ts:339](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:339) and also adds to manual buffer when capturing [extension/src/content/instagram-observer.ts:335](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:335); flush uploads that buffer again [extension/src/content/instagram-observer.ts:383](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts:383).  
Impact: Duplicate events/items for the same reel can inflate downstream counts.  
Fix: During manual capture stop, either skip immediate reel upload or dedupe by `(clientSessionId, videoId, uploadEvent)` before sending.
