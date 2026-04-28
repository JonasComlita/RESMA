# RESMA - Privacy-Preserving Recommendation Observatory

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Open-source platform for pseudonymous recommendation capture, collective algorithm transparency, and aggregate-only insight generation across TikTok, YouTube, Twitter, Instagram, and other feeds.

## Vision

Social media algorithms are black boxes that shape what billions of people see daily. RESMA is built around two connected goals:

- **Pseudonymous contribution** so people can donate recommendation/feed data without creating a named account
- **Personal transparency** so contributors can understand why they see what they see
- **Aggregate insights** so researchers, creators, and analysts can learn from cohort-level trends without exposing raw contributor feeds

The deeper thesis is that recommendation systems do not just personalize what you see, they also hide what nearby and distant social circles find relevant. If your feed is highly shaped, then there is content popular one, two, or six hops away from you that you may never see organically. RESMA is meant to make that structure inspectable:

- what your current recommendation world looks like
- what adjacent circles are seeing that you only occasionally touch
- what distant cohorts find common that your feed rarely surfaces
- what bridge content crosses between otherwise separate recommendation bubbles

Privacy, retention, and delete-all-data behavior are documented in [docs/operations/PRIVACY_AND_RETENTION.md](docs/operations/PRIVACY_AND_RETENTION.md).

## Contributor Trust & Control

RESMA is designed so contributors can participate in recommendation research without giving up named identity or raw-feed privacy.

- **Pseudonymous accounts** with recovery-code support instead of mandatory real-name or email identity
- **Delete-all-my-data controls** so contributors can permanently remove their account, snapshots, feed items, and ingest history
- **Aggregate-only creator outputs** so creator-facing forecasts and briefs never expose raw contributor feeds
- **Visible confidence gates** so degraded forecast quality is surfaced instead of silently presented as trustworthy
- **Cross-user quality diagnostics** for stitching, dedupe, parser coverage, metadata integrity, and cohort stability

This keeps the project aligned with its original observatory goal: privacy-preserving contribution first, aggregate research and creator insights second.

## Project Structure

```text
resma/
|-- extension/         # Chrome browser extension (TikTok, YouTube, Twitter & Instagram)
|-- backend/           # Node.js + Express API + Prisma
|-- frontend/          # React dashboard and analytics UI
`-- packages/shared/   # Shared Zod schemas and TS contracts
```

## Quick Start

### Prerequisites

- Bun 1.3+
- PostgreSQL 15+
- Redis (optional, for caching)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/resma.git
cd resma

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env

# Start database
docker-compose up -d postgres

# Run migrations
cd backend && bun run db:migrate

# Start development servers
bun run dev
```

### Contributor Workflow

1. Create a pseudonymous contributor account.
2. Save the recovery code returned at registration.
3. Capture feed snapshots with the browser extension.
4. Explore your contributor dashboard, cross-user observatory views, and what adjacent or distant cohorts are seeing beyond your current recommendation bubble.
5. Export aggregate-only insight briefs if you want cohort-level creator analysis.
6. Delete your account from the dashboard at any time if you want your observatory data removed.

## Packages

| Package | Description |
|---------|-------------|
| `extension` | Chrome extension for TikTok, YouTube, Twitter & Instagram feed capture |
| `backend` | Express API for data storage and analysis (TikTok, YouTube, Twitter, Instagram, and more) |
| `frontend` | React observatory dashboard for contributors plus aggregate insight tooling |
| `@resma/shared` | Shared schemas/types for capture payloads and analytics contracts |

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Disclaimer

This project is for research and educational purposes. Users are responsible for ensuring their use complies with applicable terms of service and laws. All data collection requires explicit user consent.

## Twitter Support

RESMA now supports capturing, analyzing, and comparing Twitter feeds in addition to TikTok, YouTube, and Instagram. All features are opt-in and privacy-focused.

## Performance & Storage Optimizations

RESMA uses **MessagePack + Brotli** binary serialization for efficient data storage and transmission, with legacy Zstandard-compatible read fallback.

### Storage Efficiency

- **~90% smaller** database storage compared to JSON
- **~80% smaller** network payloads from browser extension
- Optimized for TB-scale data collection

### How It Works

1. **Browser Extension** -> sends data using MessagePack binary format
2. **Backend API** -> stores data compressed with MessagePack + Brotli
3. **Database** -> PostgreSQL `BYTEA` fields instead of `JSONB`

### Migration

If you have existing data, run the migration script:

```bash
cd backend && npx tsx src/scripts/migrate-to-msgpack.ts
```

This optimization enables RESMA to efficiently handle massive amounts of feed data while minimizing storage costs and bandwidth usage.

## Architecture Enhancements (April 2026)

This release adds platform-agnostic schema design and shared contracts across extension, frontend, and backend.

### Shared Workspace Package

- Added `packages/shared` and wired `@resma/shared` into backend, frontend, and extension.
- Shared package now exports typed capture payload contracts and Zod validation schemas for:
  - cross-platform feed payloads
  - session metadata
  - recommendation rows
  - creator platform account structures

### Platform-Agnostic Creator Schema

- Replaced hardcoded creator columns (`tiktokHandle`, `tiktokId`) with a new `PlatformAccount` model.
- `Creator` now supports many platform accounts (`youtube`, `instagram`, `tiktok`, `twitter`, etc.).
- Creator APIs now resolve account context by platform and remain backward-compatible for claim flow.

### Analytics Queryability Improvements

- Added extracted engagement columns on `FeedItem` and `CreatorReach`:
  - `likesCount`
  - `commentsCount`
  - `sharesCount`
- These remain alongside packed metrics blobs so high-volume cohort filtering can use indexed SQL fields.

### Extension Build Security

- Extension build now rewrites `manifest.json` at build time:
  - development keeps localhost host permissions
  - production strips localhost host permissions automatically
- Uploads are consolidated in the service worker and validated against shared schemas.

### Migration Safety Note

If you have production data, review the migration before applying:

- Migration path backfills creator TikTok handle/id into `PlatformAccount` rows, then drops legacy columns.
- If your deployment has custom creator identity data, validate that mapping before `migrate deploy`.
- Recommended commands:

```bash
cd backend && bun run prisma migrate status
cd backend && bun run prisma migrate deploy
cd backend && bun run db:validate-platform-migration
```

### Agent Prompt Pack (Starter Stack)

If you want to run RESMA as a multi-agent workflow, start here:

- `docs/agents/STARTER_STACK_PROMPTS.md`
- `docs/operations/STARTER_STACK_NEXT_STEPS.md`

## Recent Updates (April 2026)

RESMA now includes a broader aggregate-only observatory workflow spanning machine access, agency-style report delivery, synthetic data supply, and richer graph exploration.

### Programmatic API + MCP Access

- Added API key infrastructure with hashed storage, scopes, quotas, per-route usage counting, and package-aware access control.
- Added a versioned machine-facing surface under `GET /api/v1/analysis/*` for aggregate-only analysis outputs.
- Added richer machine-consumption formats such as `format=llm`, `markdown`, and `client-report` where supported.
- Added OpenAPI discovery at `GET /docs/openapi.json` with checked-in docs under `docs/api/`.
- Added `packages/mcp`, a read-only MCP server for aggregate observatory access and agency-ready report export.

### Agency-Style Aggregate Reports

- Added package-aware access tiers: `CONTRIBUTOR_FREE`, `CREATOR_PRO`, `AGENCY_PILOT`, and `ENTERPRISE`.
- Added saved report presets, reproducible report runs, curated export formats, and aggregate-only share delivery.
- Added JWT-authenticated routes under `/reports/*` for report management workflows.
- Added a public read-only share surface at `GET /shared-reports/:shareToken`.
- Added a programmatic saved-report export route at `GET /api/v1/reports/runs/:reportRunId/export`.

All report and creator-facing outputs remain aggregate-only. They are derived from cohort-level observatory patterns rather than raw contributor feed access.

### Headless Synthetic Capture

- Added `packages/headless`, a YouTube-first synthetic observatory capture layer built on Playwright.
- Added an 8-region x 10-category profile matrix with reusable synthetic behavior traits for cold-start observatory seeding.
- Normalized headless captures into the existing `@resma/shared` ingest contract and uploaded them through the existing `/youtube/feed` pipeline without backend-only code paths.
- Added resumable orchestration, per-cell limiting, timeouts, incremental `run-summary.json` output, and local upload smoke validation.
- Added operating docs in `packages/headless/README.md` and `docs/operations/HEADLESS_SYNTHETIC_CAPTURE.md`.

### Visualization and Exploration Upgrades

- Replaced the custom graph layout worker with a D3-force layout running inside the Web Worker.
- Updated graph pan/zoom and edge rendering with D3 while preserving React-rendered nodes and current interaction behavior.
- Added lazy-loaded SandDance exploration for aggregate rows in data quality and audience forecast surfaces.
- Added Gephi-compatible `GEXF 1.3` export for recommendation maps.
- Continued shaping the frontend toward a discoverable observatory experience where contributors can inspect what is surfacing now, compare adjacent circles, and eventually browse recommendation distance across categories, regions, and platforms.

### Cross-User Comparison Data Quality Improvements

- Session stitching to better group sequential snapshots into stable viewing sessions
- Snapshot deduplication to reduce repeated-capture noise
- Stricter recommendation parsing and parser-drop diagnostics
- Cohort stability and network-strength diagnostics for confidence tracking over time
- Data quality trend charting with tunable thresholds and auto-tune support

### Forecast Reliability Upgrades

- Cohort-aware audience forecast now leverages improved stitched/deduped inputs
- Holdout evaluation endpoint and dashboard metrics for:
  - Top-k reach hit rate
  - Precision@k
  - Calibration
  - Reliability scoring

These updates reinforce the core thesis of RESMA: pseudonymous cross-user feed comparisons improve observatory quality over time, making recommendation-path modeling more useful for research, accountability work, AI-assisted analysis, and aggregate creator strategy.

## April 2026 Engineering Update

This work session focused on making the observatory path safer to operate, easier to maintain, and more scalable under repeated analytics traffic.

### Backend hardening and consistency

- Extracted shared ingest/helper utilities so platform routes stop duplicating the same parsing and sanitization logic.
- Added shared request validation middleware for analysis, insights, feeds, and ingest boundaries.
- Normalized major ingest routes onto shared error middleware instead of mixed inline error responses.
- Improved analysis rate limiting so authenticated analysis traffic can be keyed per user where available.
- Added a short-lived premium-tier cache to avoid querying Prisma on every protected request.
- Added a database-backed health check and graceful shutdown flow for the backend process.

### Forecast and analytics scalability

- Split the audience forecast system into focused modules for loading, model building, quality gating, and forecast computation.
- Added in-memory dataset, materialized model, lift-stability, and holdout-evaluation caching keyed by snapshot watermark so repeated forecast requests reuse stitched inputs and computed models.
- Reused that same materialized forecast context for go-to-market brief generation.
- Upgraded the similarity analysis from simple creator-handle overlap to weighted same-platform snapshot-profile matching.

### Frontend and extension improvements

- Moved recommendation graph layout work off the main thread into a Web Worker to reduce UI freezes on larger graphs.
- Broke the dashboard into smaller hooks and sections for forecast, data quality, recommendation mapping, and account deletion workflows.
- Hardened extension auth handling with token expiry checks, clearer invalid-session behavior, and better popup error surfacing.

### Schema and cleanup

- Removed dormant `PatternGroup` and `PatternGroupMembership` schema pieces and added a migration to drop the unused tables.
- Removed dead migration-script handling tied to those unused pattern-group records.

### Verification highlights

- Backend builds passed after the refactors and cache/materialization work.
- Targeted backend tests now cover request hardening, premium caching, upgraded similarity behavior, and analytics caching/materialization paths.
- Frontend builds passed after the dashboard decomposition and graph worker migration.

## Future Goals

### Research Agent Roadmap

RESMA now ships the foundation for agent-assisted workflows:

- a machine-facing MCP server for aggregate observatory access
- LLM-friendly programmatic API responses for analysis and report export
- a YouTube-first synthetic headless capture layer for cold-start observatory seeding

The next step is a source-linked external research layer on top of that foundation:

- add optional web-enabled agents that gather current external context such as platform UI or policy changes, creator trend signals, and market benchmarks
- use that external context as an augmentation layer for forecasting and report generation, while keeping RESMA's first-party observatory data as the source of truth for core modeling
- require source-linked outputs from external research agents so human users and downstream AI tools can audit where claims came from

### Observatory Discovery Roadmap

Another major product direction is making recommendation distance legible to contributors and analysts, not just measurable in backend models.

- build a Discover-style observatory surface for "what's surfacing now"
- add category, region, and platform selectors so users can compare what different circles find relevant
- surface adjacent, distant, and bridge content so people can see what their current profile is not being shown
- keep the core observatory feed as a truth surface, while any sponsor or advertiser modules stay clearly labeled and visually separate from measured recommendation content
- provide clear opt-out and account-deletion paths that are easy to find and use

## Performance & Build Optimizations (2026 Migration)

In April 2026, the RESMA monorepo underwent a significant architectural migration to optimize developer velocity and runtime performance.

### 1. Bun Stack Migration
The project transitioned from Node.js/pnpm to **Bun** as the primary runtime, package manager, and test runner.
- **Speed**: Dependencies install significantly faster via `bun install`.
- **Native Execution**: Removed `tsx` and `dotenv` dependencies; Bun natively executes TypeScript and loads `.env` files.
- **Unified Tooling**: Replaced `vitest` with `bun test` for a high-performance, built-in testing experience.

### 2. TypeScript 7.0 Beta (tsgo)
We integrated the **TypeScript 7.0 Native Preview** (`tsgo`) to parallelize the monorepo's type-checking pipeline.
- **Parallel Builds**: Using `tsgo --build --builders 4 --checkers 4` allows concurrent type-checking across all workspace packages.
- **Native Performance**: Leverages a Go-based native compiler for massive speed gains in large monorepo structures.
- **Modern Standards**: Migrated all configurations to comply with TS 7.0 standards (e.g., removing `baseUrl` in favor of explicit `paths`).
