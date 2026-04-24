# RESMA MCP Server

Read-only MCP wrapper for RESMA's aggregate-only programmatic API.

## What it exposes

- `audience_forecast`
- `recommendation_map`
- `go_to_market_brief`
- `data_quality`
- `observatory_stats`

These tools call `backend`'s versioned machine surface under `/api/v1/analysis/*`.

## Environment

```bash
RESMA_API_BASE_URL=http://localhost:3001
RESMA_API_KEY=resma_test.your_lookup_id.your_secret
```

## Local run

```bash
pnpm --filter @resma/mcp dev
```

## Privacy boundary

The MCP server is intentionally aggregate-only. It does not expose raw contributor feed rows or contributor identity.
