# RESMA - Reverse Engineering Social Media Algorithms

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Open-source platform for collectively understanding how TikTok, YouTube, Twitter, Instagram, and other algorithms shape feeds through crowdsourced data collection.

## 🎯 Vision

Social media algorithms are black boxes that shape what billions of people see daily. RESMA empowers users to:

- **Capture** their TikTok, YouTube, Twitter, and Instagram feed data through a browser extension
- **Compare** their feeds with others to discover patterns
- **Contribute** to open research on recommendation systems

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

## 📦 Packages

| Package | Description |
|---------|-------------|
| `extension` | Chrome extension for TikTok, YouTube, Twitter & Instagram feed capture |
| `backend` | Express API for data storage and analysis (TikTok, YouTube, Twitter, Instagram, and more) |
| `frontend` | React dashboard for analytics, diagnostics, and creator tooling |
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

RESMA now includes a stronger creator-facing analytics workflow focused on cross-user comparison quality and practical go-to-market output.

### Creator-Facing Go-to-Market Brief Export

- New API route: `GET /analysis/go-to-market-brief`
- New dashboard action: **Export Go-to-market Brief** from the Cohort-Aware Audience Forecast section
- Export output includes:
  - Top audience cohorts
  - Lift vs global baseline
  - Predicted reach paths from an optional seed video
  - Confidence bands for exposure estimates
  - Key takeaways and markdown-formatted brief output for sharing

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

These updates reinforce the core thesis of RESMA: cross-user feed comparisons improve predictive quality over time, making recommendation-path modeling more useful for creator strategy and B2B/marketing decision support.

## 🔭 Future Goals

### Web-Enabled Research Agents

- Add optional web-enabled agents that can gather current external context (platform UI/policy changes, creator trend signals, and market benchmarks) faster than manual research.
- Use this as an augmentation layer for forecasting and go-to-market briefs, while keeping RESMA's first-party cross-user feed data as the source of truth for core modeling.
- Require source-linked outputs from web research agents to improve transparency and reduce noisy inputs.
