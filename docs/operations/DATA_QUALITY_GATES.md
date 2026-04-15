# Data Quality Gates (Milestone 2-3)

This document is the policy baseline for cross-user comparison reliability in RESMA.

## Why These Gates Exist

- Prevent false confidence when parser coverage or strict-row counts are weak.
- Prevent lift interpretation when cohort/sample stability is too low.
- Make degraded windows explicit in forecast and brief outputs.

## Platform Thresholds

| Platform | Min Parse Coverage | Max Parser Drop | Min Strict Rows | Min Compared Users | Min Cohort Stability | Min Cohort Users For Lift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| YouTube | 0.24 | 0.76 | 8 | 4 | 0.62 | 3 |
| Instagram | 0.20 | 0.80 | 6 | 3 | 0.58 | 3 |
| TikTok | 0.20 | 0.80 | 6 | 3 | 0.58 | 3 |
| Default (fallback) | 0.20 | 0.80 | 6 | 3 | 0.55 | 3 |

Rationale:
- YouTube thresholds are stricter due denser recommendation surfaces and higher strict-row expectation.
- Instagram/TikTok allow lower strict-row and coverage floors to account for parser variance while still requiring non-trivial edges.
- Cohort stability floors ensure sparse/noisy windows do not produce lift claims.

## Confidence Degradation Rules

Confidence multiplier starts at `1.0` and degrades when any gate fails. Penalties are applied for:

- parse coverage below minimum
- parser drop above maximum
- strict rows below minimum
- compared users below minimum
- cohort stability below minimum
- forecast reliability unavailable/low (brief path)

Final multiplier is clamped to `[0.35, 1.0]`.

Status behavior:
- `ok`: no failed checks
- `degraded`: one or more failed checks

Lift behavior:
- `canInterpretLift = false` when quality gates fail or forecast reliability is unavailable/low.
- Cohort lift is withheld (`null`) when interpretation is gated.

## Observable Outputs

- `GET /analysis/data-quality`
  - `qualityGate` now exposes thresholds, failed reason codes, human-readable degradation reasons, and confidence multiplier.
- `GET /analysis/data-quality-trends`
  - points now include `strictRecommendationRows`, `qualityGateStatus`, `qualityGateReasons`.
  - trend-level `drift` summary reports deltas and `stable|warning|critical` status.
- `GET /analysis/audience-forecast`
  - quality gate payload includes explicit confidence and lift-interpretation state.
- `GET /analysis/go-to-market-brief`
  - brief includes holdout reliability interpretation and platform-specific path evidence.

## Release Gate Policy

Release should fail when unresolved P0/P1 findings exist in quality gates or review cycle.

Rollback note:
- If quality-gate behavior regresses production confidence, rollback to prior forecast/brief service version and temporarily force `qualityGate.status = degraded` for affected platform windows until parser and stitching diagnostics recover.
