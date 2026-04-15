# Starter Stack Next Steps

This checklist turns the 5-agent starter stack into executable milestones.

## Milestone 1: Migration Safety and Contract Baseline

Owner agents: Schema-Contracts, Ingestion-Gateway

1. Validate creator/account migration integrity in staging.
2. Verify all platform payloads conform to `@resma/shared` schemas.
3. Confirm service worker always uses authenticated upload path.

Acceptance:
- No unresolved P0/P1 findings.
- Migration validation script passes.
- Extension upload works in MessagePack + JSON fallback mode.

## Milestone 2: Recommendation Edge Reliability

Owner agents: Recommendation-Parser, Data-Quality

1. Ensure Instagram and TikTok produce non-trivial recommendation edges.
2. Track parser-drop, strict-row count, dedupe impact by platform.
3. Set degraded-confidence behavior for low-coverage windows.

Acceptance:
- Non-zero strict recommendation rows for YT/IG/TikTok fixtures.
- Parser coverage thresholds are documented and enforced.
- Forecast/brief confidence degrades when thresholds fail.
- Policy source: `docs/operations/DATA_QUALITY_GATES.md`

## Milestone 3: Cohort Stability and Forecast Confidence

Owner agents: Cohort-Modeling, Data-Quality

1. Add minimum-sample and stability gates before lift interpretation.
2. Validate holdout metrics by platform and key cohorts.
3. Ensure go-to-market brief sections use platform-specific path evidence.

Acceptance:
- Cohort lift metrics are stable across adjacent windows.
- Forecast reliability metrics available and interpreted in brief.
- No unresolved P0/P1 findings at release gate.
