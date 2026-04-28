# RESMA MCP Server

Read-only MCP wrapper for RESMA's aggregate-only programmatic API.

## What it exposes

- `audience_forecast`
- `recommendation_map`
- `go_to_market_brief`
- `data_quality`
- `observatory_stats`
- `agency_report_export`

These tools call `backend`'s versioned machine surface under `/api/v1/analysis/*` and `/api/v1/reports/*`.

## Positioning

This MCP server is for aggregate observatory intelligence and white-glove report delivery. It is intentionally read-only, aggregate-only, and package-aware.

## Environment

```bash
RESMA_API_BASE_URL=http://localhost:3001
RESMA_API_KEY=resma_test.your_lookup_id.your_secret
```

For `agency_report_export`, the API key must include a package with report export access such as `AGENCY_PILOT` or `ENTERPRISE`.

## Local run

```bash
bun run --filter @resma/mcp dev
```

## Privacy boundary

The MCP server is intentionally aggregate-only. It does not expose raw contributor feed rows or contributor identity.
