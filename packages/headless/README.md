# `@resma/headless`

YouTube-first synthetic observatory capture for RESMA cold-start data generation.

This package creates region-aware, category-stable synthetic research sessions that can:

- browse the same 10 core categories across 8 target regions
- emit capture payloads that already conform to `@resma/shared`
- save artifacts locally for QA and replay
- optionally upload those artifacts to the existing ingest routes without backend changes

Signed-out synthetic capture remains the default. Governed research-account mode is a separate, opt-in operating path for the small set of cases where signed-in observatory capture is necessary.

## What Is Runnable Now

Today this package can run a minimal YouTube-first headless flow:

1. launch a persistent Playwright browser context for a synthetic profile
2. open localized YouTube home/search/watch surfaces
3. collect homepage items, search results, and watch-next recommendations
4. normalize the session into the shared ingest payload contract
5. write a JSON artifact locally
6. optionally POST the artifact to `/youtube/feed` using the existing authenticated ingest route
7. write a `run-summary.json` coverage/quality report for low-volume QA

## Profile Matrix

Every region browses the same core category set:

- United States
- United Kingdom
- Canada
- Brazil
- Germany
- India
- Japan
- Mexico

Core categories:

- Entertainment
- Gaming
- Music
- Fitness & Health
- Food & Cooking
- Beauty & Fashion
- Technology
- Finance & Business
- News & Politics
- Sports

Behavioral variation is layered on top of each region/category pair through reusable trait bundles:

- `scanner`
- `steady-viewer`
- `engaged-sampler`
- `repeat-explorer`

Traits cover:

- watch duration tendencies
- watch duration ratio targets
- scroll cadence
- interaction frequency
- session length
- revisit behavior

## Usage

Install workspace dependencies first:

```bash
pnpm install
```

Build just this package:

```bash
pnpm --filter @resma/headless build
```

Run one local artifact capture without uploading:

```bash
pnpm --filter @resma/headless capture --region us --category technology --limit 1
```

Run with a locally installed browser channel if Playwright browsers are not installed:

```bash
pnpm --filter @resma/headless capture --region jp --category music --limit 1 --browser-channel chrome
```

Upload through the existing ingest pipeline:

```bash
pnpm --filter @resma/headless capture --region us --category news-politics --limit 1 --upload --api-url http://localhost:3001 --token <jwt>
```

Run a matrix with one profile per requested region/category cell:

```bash
pnpm --filter @resma/headless capture --region "us uk ca br de in jp mx" --category "technology music news-politics sports" --limit 1 --upload --api-url http://localhost:3001 --token <jwt>
```

Global cap semantics now live on `--max-profiles` instead of `--limit`:

```bash
pnpm --filter @resma/headless capture --region "us uk" --category "technology music" --limit 1 --max-profiles 2
```

Long-running matrix runs can be resumed safely from the same output directory:

```bash
pnpm --filter @resma/headless capture --region "us uk ca br de in jp mx" --category "technology music news-politics sports" --limit 1 --upload --api-url http://localhost:3001 --token <jwt> --output-dir .captures/headless-matrix-upload-1
```

By default the runner will:

- reuse existing artifact files in the selected output directory
- rewrite `run-summary.json` after each profile
- stop waiting on a single profile after `180000ms`

Useful flags:

- `--timeout-ms 240000` to raise/lower the per-profile timeout
- `--no-resume` to ignore existing artifacts and start fresh

## Governed Research-Account Mode

This package supports a deliberately narrow signed-in mode for manually provisioned research accounts.

What it is:

- passive observatory capture for recommendation study
- explicitly opt-in and policy-sensitive
- limited to a manually curated account pool

What it is not:

- account creation automation
- posting, following, liking, replying, messaging, or growth automation
- impersonation or deceptive identity

Current constraints:

- signed-out capture remains the default
- governed research-account mode is only allowlisted for `youtube`
- the only supported credential source is a manually prepared persistent user-data directory
- the only supported signed-in capture mode is `passive-observation-only`

Use a local config based on [research-accounts.example.json](./research-accounts.example.json). The example is intentionally conservative: it starts `paused` and `local-manual-only` so operators must make an explicit governance decision before enabling orchestrated use.

Example command:

```bash
pnpm --filter @resma/headless capture \
  --enable-governed-research-account-mode \
  --research-account-config C:/local/resma/research-accounts.json \
  --research-account yt-observatory-us-1 \
  --region us \
  --category technology \
  --limit 1 \
  --upload \
  --api-url http://localhost:3001 \
  --token <jwt>
```

When this mode is enabled:

- output defaults to `./.captures/headless-research-accounts/<account-id>`
- session metadata is tagged so downstream systems can distinguish research-account captures
- the CLI logs the account label, purpose, and passive-capture policy
- paused, retired, unsupported, or `local-manual-only` accounts are rejected for orchestrated runs

Environment variables:

- `RESMA_API_URL`
- `RESMA_TOKEN`
- `RESMA_BROWSER_CHANNEL`

Artifacts are written to:

- default payload output: `./.captures/headless`
- default persistent browser state: `./.captures/profiles`
- per-run summary: `run-summary.json` in the selected output directory

## Ingest Integration

The package deliberately reuses the current pipeline unchanged:

- YouTube uploads target `POST /youtube/feed`
- request shape matches the extension route shape: `{ feed, sessionMetadata }`
- payload normalization runs through `coercePlatformFeedPayload(...)`
- auth uses the same bearer token model as the browser extension
- upload idempotency uses the existing `X-Resma-Upload-Id` header

This means synthetic captures can be blended into the observatory without adding backend-only code paths.

## QA Notes

Each run now emits a summary file with:

- completed vs failed profile counts
- low-recommendation profiles
- low-search-result profiles
- coverage cell counts
- missing region/category cells

That makes it easier to start with low-volume matrix runs and quickly see where recommendation density or coverage is weak before scaling up.

CLI note:

- `--limit` applies per region/category cell after filtering
- `--max-profiles` applies a global cap after per-cell limiting
- `--timeout-ms` applies per profile, not to the whole batch
- reruns resume from existing artifacts in the same `--output-dir` unless `--no-resume` is set

## Local Upload Troubleshooting

If `--upload` reaches the backend but auth registration or ingest persistence fails on a fresh local database, check local schema ownership and migration state first.

Typical healthy setup:

```bash
pnpm --filter backend db:generate
pnpm --filter backend exec prisma migrate deploy
```

If Prisma reports `permission denied for schema public`, the local Postgres role in `backend/.env` does not currently have create privileges on the target schema. That is an environment/database ownership issue, not a headless package issue, and it must be corrected before authenticated upload smoke tests can pass.

## Research Assumptions

- default mode is **synthetic logged-out browsing**, not real-person impersonation
- governed research-account mode is an explicit exception path for signed-in recommendation observation only
- persistent storage directories are profile-specific so revisit patterns can be studied over time
- no posting, commenting, monetization behavior, or creator impersonation is included
- interaction is limited to browsing/navigation signals such as opening watch pages and revisiting adjacent queries
- manually provisioned account credentials must stay local and out of Git

## Ethics, TOS, and Data Quality

See [docs/operations/HEADLESS_SYNTHETIC_CAPTURE.md](../../docs/operations/HEADLESS_SYNTHETIC_CAPTURE.md) and [docs/operations/HEADLESS_RESEARCH_ACCOUNTS.md](../../docs/operations/HEADLESS_RESEARCH_ACCOUNTS.md) for the operating guidance that should gate use of this package.
