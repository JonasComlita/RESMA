# Privacy And Retention

RESMA is a pseudonymous recommendation observatory.

## What contributor data is stored

- A pseudonymous contributor account with an `anonymousId`, password hash, and recovery-code hash
- Uploaded feed snapshots from supported platforms
- Feed items, engagement metadata, and session metadata needed for observatory analysis
- Ingest idempotency records that prevent duplicate uploads from being double-counted

## What creator-facing outputs can use

- Aggregate cohort-level analytics only
- No raw contributor feed drilldowns
- No named identity is required for contributor participation

## Retention model

- Contributor data is retained so recommendation and forecasting research can improve over time
- Session metadata is used to stitch related captures, detect duplicate uploads, and measure observatory quality
- Invalid metadata is treated as a quality concern and should degrade confidence rather than silently disappear

## Delete-all-my-data flow

- Contributors can delete their account from the dashboard by typing their exact contributor ID
- Deletion removes the contributor account and all owned snapshots, feed items, and ingest records through cascading relations
- Deletion is permanent and logs the contributor out immediately
