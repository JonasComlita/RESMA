# RESMA - Privacy-Preserving Recommendation Observatory

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Open-source platform for pseudonymous recommendation capture, collective algorithm transparency, and aggregate-only insight generation across TikTok, YouTube, Twitter, Instagram, and other feeds.

## 🎯 Vision

Social media algorithms are black boxes that shape what billions of people see daily. RESMA is built around two connected goals:

- **Pseudonymous contribution** so people can donate recommendation/feed data without creating a named account
- **Personal transparency** so contributors can understand why they see what they see
- **Aggregate insights** so researchers, creators, and analysts can learn from cohort-level trends without exposing raw contributor feeds

Privacy, retention, and delete-all-data behavior are documented in [docs/operations/PRIVACY_AND_RETENTION.md](docs/operations/PRIVACY_AND_RETENTION.md).

## Contributor Trust & Control

RESMA is designed so contributors can participate in recommendation research without giving up named identity or raw-feed privacy.

- **Pseudonymous accounts** with recovery-code support instead of mandatory real-name or email identity
- **Delete-all-my-data controls** so contributors can permanently remove their account, snapshots, feed items, and ingest history
- **Aggregate-only creator outputs** so creator-facing forecasts and briefs never expose raw contributor feeds
- **Visible confidence gates** so degraded forecast quality is surfaced instead of silently presented as trustworthy
- **Cross-user quality diagnostics** for stitching, dedupe, parser coverage, metadata integrity, and cohort stability

This keeps the project aligned with its original observatory goal: privacy-preserving contribution first, aggregate research and creator insights second.

## 🏗️ Project Structure

```
resma/
├── extension/         # Chrome browser extension (TikTok, YouTube, Twitter & Instagram)
├── backend/           # Node.js + Express API + Prisma
├── frontend/          # React dashboard and analytics UI
└── packages/shared/   # Shared Zod schemas and TS contracts
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- pnpm 8+
- PostgreSQL 15+
- Redis (optional, for caching)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/resma.git
cd resma

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env

# Start database
docker-compose up -d postgres

# Run migrations
pnpm --filter backend db:migrate

# Start development servers
pnpm dev
```

### Contributor Workflow

1. Create a pseudonymous contributor account.
2. Save the recovery code returned at registration.
3. Capture feed snapshots with the browser extension.
4. Explore your contributor dashboard and cross-user observatory views.
5. Export aggregate-only insight briefs if you want cohort-level creator analysis.
6. Delete your account from the dashboard at any time if you want your observatory data removed.

## 📦 Packages

| Package | Description |
|---------|-------------|
| `extension` | Chrome extension for TikTok, YouTube, Twitter & Instagram feed capture |
| `backend` | Express API for data storage and analysis (TikTok, YouTube, Twitter, Instagram, and more) |
| `frontend` | React observatory dashboard for contributors plus aggregate insight tooling |
| `@resma/shared` | Shared schemas/types for capture payloads and analytics contracts |


## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This project is for research and educational purposes. Users are responsible for ensuring their use complies with applicable terms of service and laws. All data collection requires explicit user consent.

## 🐦 Twitter Support

RESMA now supports capturing, analyzing, and comparing Twitter feeds in addition to TikTok, YouTube, and Instagram. All features are opt-in and privacy-focused.

## ⚡ Performance & Storage Optimizations

RESMA uses **MessagePack + Brotli** binary serialization for efficient data storage and transmission (with legacy Zstandard-compatible read fallback):

### Storage Efficiency
- **~90% smaller** database storage compared to JSON
- **~80% smaller** network payloads from browser extension
- Optimized for TB-scale data collection

### How It Works
1. **Browser Extension** → Sends data using MessagePack binary format
2. **Backend API** → Stores data compressed with MessagePack + Brotli
3. **Database** → PostgreSQL `BYTEA` fields instead of `JSONB`

### Migration
If you have existing data, run the migration script:
```bash
cd backend && npx tsx src/scripts/migrate-to-msgpack.ts
```

This optimization enables RESMA to efficiently handle massive amounts of feed data while minimizing storage costs and bandwidth usage.

## 🧱 Architecture Enhancements (April 2026)

This release adds platform-agnostic schema design and shared contracts across extension/frontend/backend.

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
pnpm --filter backend prisma migrate status
pnpm --filter backend prisma migrate deploy
pnpm --filter backend db:validate-platform-migration
```

### Agent Prompt Pack (Starter Stack)

If you want to run RESMA as a multi-agent workflow, start here:

- `docs/agents/STARTER_STACK_PROMPTS.md`
- `docs/operations/STARTER_STACK_NEXT_STEPS.md`

## 🧭 Recent Updates (April 2026)

RESMA now includes a stronger aggregate insight workflow built on observatory-wide, cross-user comparison quality.

### Aggregate Insight Brief Export

- New API route: `GET /analysis/go-to-market-brief`
- New dashboard action: **Export Aggregate Brief** from the aggregate forecast section
- Export output includes:
  - Top audience cohorts
  - Lift vs global baseline
  - Predicted reach paths from an optional seed video
  - Confidence bands for exposure estimates
  - Key takeaways and markdown-formatted brief output for sharing

All creator-facing outputs are intended to remain aggregate-only. They are derived from cohort-level observatory patterns rather than raw contributor feed access.

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

These updates reinforce the core thesis of RESMA: pseudonymous cross-user feed comparisons improve observatory quality over time, making recommendation-path modeling more useful for research, accountability work, and aggregate creator strategy.

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

## 🔭 Future Goals

### Web-Enabled Research Agents

- Add optional web-enabled agents that can gather current external context (platform UI/policy changes, creator trend signals, and market benchmarks) faster than manual research.
- Use this as an augmentation layer for forecasting and go-to-market briefs, while keeping RESMA's first-party cross-user feed data as the source of truth for core modeling.
- Require source-linked outputs from web research agents to improve transparency and reduce noisy inputs.
