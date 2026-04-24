# RESMA Programmatic API

RESMA now has a stable machine-facing surface for aggregate-only analysis and AI clients.

## Discovery

- Runtime docs path: `/docs`
- OpenAPI JSON: `/docs/openapi.json`
- Versioned programmatic routes: `/api/v1/analysis/*`
- JWT-authenticated API key management: `/api-keys`

## Auth model

- Human dashboard routes still use contributor JWTs.
- Programmatic routes use API keys via `x-api-key` or `Authorization: Bearer <api-key>`.
- API keys are stored hashed, scoped, quota-limited, and usage-counted by day/route.

## LLM-friendly mode

Programmatic analysis routes accept `format=llm`.

That response keeps the structured JSON payload and adds:

- `llm.title`
- `llm.bullets`
- `llm.markdown`
- `llm.followUpQuestions`
- `llm.caveats`

This is meant for agents that want a human-readable summary without losing machine-readable structure.

## Stable endpoints

- `GET /api/v1/analysis/audience-forecast`
- `GET /api/v1/analysis/recommendation-map`
- `GET /api/v1/analysis/go-to-market-brief`
- `GET /api/v1/analysis/data-quality`
- `GET /api/v1/analysis/stats`

## Privacy boundary

- Aggregate-only creator outputs stay intact.
- No raw contributor feeds are exposed in this surface.
- Quality-gate degradations should be surfaced to downstream consumers instead of hidden.
