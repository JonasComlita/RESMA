# RESMA Programmatic API

RESMA now has a stable machine-facing surface for aggregate-only analysis, agency report delivery, and AI clients.

## Discovery

- Runtime docs path: `/docs`
- OpenAPI JSON: `/docs/openapi.json`
- Versioned programmatic routes: `/api/v1/analysis/*`
- Versioned saved-report export route: `/api/v1/reports/runs/:reportRunId/export`
- JWT-authenticated API key management: `/api-keys`
- JWT-authenticated agency report workflows: `/reports/*`
- Read-only shared report delivery: `/shared-reports/:shareToken`

## Auth model

- Human dashboard routes still use contributor JWTs.
- Programmatic routes use API keys via `x-api-key` or `Authorization: Bearer <api-key>`.
- Operator-facing report preset/run/share routes use contributor JWTs.
- API keys are stored hashed, scoped, package-aware, quota-limited, and usage-counted by day/route.
- Quotas are safety and contract-enforcement caps, not usage-based billing.

## Package model

RESMA treats the API as a premium delivery channel for observatory intelligence, not as a metered developer product.

Current internal packages:

- `CONTRIBUTOR_FREE`
- `CREATOR_PRO`
- `AGENCY_PILOT`
- `ENTERPRISE`

Package entitlements control:

- which routes are available
- which response/export formats are available
- which report types can be saved and regenerated
- freshness windows
- share-link access
- MCP eligibility

## LLM-friendly mode

Programmatic analysis routes accept `format=json|llm|markdown|client-report`.

Supported shapes:

- `json`: structured machine payload
- `llm`: structured payload plus `llm.title`, `llm.bullets`, `llm.markdown`, `llm.followUpQuestions`, and `llm.caveats`
- `markdown`: curated markdown export for internal operator or downstream rendering
- `client-report`: stable aggregate report document suitable for read-only client delivery / PDF rendering pipelines

Availability is package-dependent. Lower tiers may only receive a subset of these formats.

## Stable endpoints

- `GET /api/v1/analysis/audience-forecast`
- `GET /api/v1/analysis/recommendation-map`
- `GET /api/v1/analysis/go-to-market-brief`
- `GET /api/v1/analysis/data-quality`
- `GET /api/v1/analysis/stats`
- `GET /api/v1/reports/runs/:reportRunId/export`

## Agency report workflow

JWT-authenticated operator routes now support:

- saved report presets
- reproducible report runs
- curated exports
- read-only share links
- package entitlement inspection

Primary report deliverables:

- `AUDIENCE_OPPORTUNITY_BRIEF`
- `COMPETITOR_REACH_SNAPSHOT`
- `RECOMMENDATION_GAP_REPORT`

The stored report run may include richer internal operator context, but exported and shared outputs stay curated and aggregate-only.

## Privacy boundary

- Aggregate-only creator outputs stay intact.
- No raw contributor feeds are exposed in this surface.
- No cohort member drilldowns or per-user traces are exposed.
- Quality-gate degradations should be surfaced to downstream consumers instead of hidden.
- Shared report links return read-only curated exports and do not expose hidden operator metadata.
