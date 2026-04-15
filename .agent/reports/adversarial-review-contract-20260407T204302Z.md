1. **[P1] Capture opt-in is bypassed; YouTube and Instagram upload without `START_CAPTURE` (trust-boundary/abuse)**  
Confidence: **High**  
Files: [youtube-observer.ts#L92](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts#L92), [youtube-observer.ts#L119](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts#L119), [youtube-observer.ts#L175](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts#L175), [youtube-observer.ts#L218](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts#L218), [youtube-observer.ts#L529](/Users/jonas/Documents/RESMA-main/extension/src/content/youtube-observer.ts#L529), [instagram-observer.ts#L99](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L99), [instagram-observer.ts#L354](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L354), [Popup.tsx#L160](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx#L160)  
Repro: Log in, open YouTube/Instagram, never press Start Capture, watch network/backend logs; uploads still occur.  
Fix: Gate *all* capture/upload entry points on explicit capture state (or explicit user setting for auto mode), and enforce that gate in background before upload.

2. **[P1] Instagram path can repeatedly re-upload the same items every 12s (abuse + silent duplication)**  
Confidence: **High**  
Files: [instagram-observer.ts#L100](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L100), [instagram-observer.ts#L334](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L334), [instagram-observer.ts#L354](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L354), [instagram-observer.ts#L364](/Users/jonas/Documents/RESMA-main/extension/src/content/instagram-observer.ts#L364)  
Repro: Stay on IG feed/reels for a few minutes; snapshots keep being sent with overlapping `videoId`s.  
Fix: Send deltas only (or mark uploaded items), clear/compact sent state after success, and attach deterministic idempotency keys per logical snapshot.

3. **[P2] `SET_TOKEN` allows runtime API URL override, enabling token exfil if an extension context is compromised (trust-boundary)**  
Confidence: **Medium**  
Files: [service-worker.ts#L521](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L521), [service-worker.ts#L530](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L530), [service-worker.ts#L95](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L95), [service-worker.ts#L343](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L343)  
Repro: From an extension context, send `SET_TOKEN` with `apiUrl: "https://attacker.example"`, then trigger auth check/upload; bearer token is sent to attacker host.  
Fix: Validate sender trust, remove runtime-controlled API base URL in production, and hard-allowlist backend origins.

4. **[P2] `/youtube/feed` is fail-open: invalid items are silently dropped but request still succeeds (silent corruption/false-success)**  
Confidence: **High**  
Files: [youtube.ts#L198](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L198), [youtube.ts#L217](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L217), [youtube.ts#L270](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L270), [youtube.ts#L330](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L330)  
Repro: POST 10 items with only 1 valid `videoId`; endpoint returns `201` and stores only the valid subset.  
Fix: Use `requireFullFeedValidity: true` (or return rejected-item counts/errors) so partial loss is explicit.

5. **[P2] Upload failures are not surfaced to user and are not retried durably (false-success + rollback/data-loss gap)**  
Confidence: **High**  
Files: [service-worker.ts#L431](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L431), [service-worker.ts#L450](/Users/jonas/Documents/RESMA-main/extension/src/background/service-worker.ts#L450), [Popup.tsx#L93](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx#L93), [Popup.tsx#L140](/Users/jonas/Documents/RESMA-main/extension/src/popup/Popup.tsx#L140)  
Repro: Make backend unreachable, stop capture; popup still shows “Captured N …” while service worker logs failed upload, and payload is dropped.  
Fix: Return per-upload ack/failure to UI, persist unsent payloads (queue in storage/IndexedDB), and retry with bounded backoff.

6. **[P3] YouTube numeric metric parsing drops legitimate zeros (silent corruption)**  
Confidence: **High**  
Files: [youtube.ts#L19](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L19), [youtube.ts#L227](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L227), [youtube.ts#L240](/Users/jonas/Documents/RESMA-main/backend/src/routes/youtube.ts#L240)  
Repro: Send `likes: 0`, `comments: 0`, `seekCount: 0`; persisted packed metrics store `null/undefined` instead of `0`.  
Fix: Replace `parsePositiveInt` usages for count fields with non-negative parsing (`>= 0`) so zero is preserved.
