# `@resma/shared`

Shared payload contract for RESMA ingest routes and extension uploads.

## Contract Version Bumps

Use this process when the payload shape changes:

1. Bump `CURRENT_INGEST_VERSION` in [`src/index.ts`](./src/index.ts).
2. Bump the relevant entry in `CURRENT_OBSERVER_VERSIONS` if a platform-specific observer payload changed.
3. Keep coercion backwards-compatible when possible by adding alias handling in `coercePlatformFeedPayload` or `coerceFeedSnapshotEnvelope`.
4. Add or update contract tests in [`../../backend/tests/payload-contract.test.ts`](../../backend/tests/payload-contract.test.ts).
5. Rebuild `@resma/shared` and run the payload contract tests before shipping.

Use semver for `CURRENT_INGEST_VERSION`:

- Patch: internal normalization change, no payload shape change
- Minor: additive payload fields or new accepted aliases
- Major: breaking ingest contract change or removal of accepted legacy shapes

If a change would break old extension uploads, ship the new coercion first, then update observers, then remove legacy handling only after all clients have migrated.
