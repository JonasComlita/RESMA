# Headless Synthetic Capture

This document defines the operating guardrails for RESMA's synthetic observatory capture layer.

## Purpose

Goal 1 needs denser observatory data before contributor scale arrives:

> If you can predict which videos will be recommended to you, you can predict who your videos will be recommended to.

The synthetic layer exists to create **comparable recommendation captures** across regions and categories so the current modeling stack has more coverage to learn from.

## Allowed Research Posture

Use synthetic profiles for research, not impersonation.

Baseline assumptions:

- use logged-out or explicitly labeled research-only browser profiles
- do not present these profiles as real people
- do not message, comment, post, like, subscribe, or monetize from these profiles
- keep behavior limited to low-risk browsing, result opening, scrolling, and repeat navigation patterns
- preserve clear provenance in metadata so downstream analysis can segment synthetic captures from contributor captures
- treat signed-in research-account usage as a separate, higher-risk mode with explicit governance

## Regions

Each region must browse the same core category set:

- United States
- United Kingdom
- Canada
- Brazil
- Germany
- India
- Japan
- Mexico

## Categories

Each region browses all of these categories:

- Entertainment
- Gaming
- Music
- Fitness & Health
- Food & Cooking
- Beauty & Fashion
- Technology
- Finance & Business
- News & Politics
- Sports

The goal is not to maximize local flavor at the expense of comparability. It is to keep the same domain matrix active in every region so geographic recommendation divergence is measurable.

## Behavioral Traits

The headless package ships four reusable trait bundles:

- `scanner`: short watch windows, fast scrolls, low revisit probability
- `steady-viewer`: longer watch windows and same-query revisits
- `engaged-sampler`: higher click-through with adjacent-query follow-ups
- `repeat-explorer`: channel-adjacent revisits for drift comparison

Traits encode:

- watch duration tendencies
- watch duration ratio targets
- scroll cadence
- interaction frequency
- session length
- revisit pattern

These traits are synthetic abstractions. They should be treated as controlled experimental levers, not as claims about real population segments.

## Ingest Plan

Synthetic capture should enter RESMA through the existing ingest contracts:

1. Capture headless YouTube sessions into `@resma/shared` payloads.
2. Upload YouTube sessions to `POST /youtube/feed`.
3. Keep extra provenance in `sessionMetadata` fields such as:
   - `researchMode`
   - `syntheticProfileId`
   - `syntheticRegion`
   - `syntheticCategory`
   - `syntheticBehavior`
4. Do not special-case backend persistence unless analysis needs explicit filtering later.
5. If segmentation becomes necessary, do it downstream by reading the metadata already attached at ingest.

Research-account captures must also tag explicit governance metadata, including account id/label references and signed-in capture identity, so downstream systems can audit this mode separately from signed-out synthetic runs.

## Data Quality Expectations

What this layer is good at:

- generating repeatable recommendation captures for the same region/category cells
- filling sparse areas of the observatory so recommendation-path models have denser adjacency data
- providing controlled drift checks over time

What this layer is not good at:

- representing real user identity or creator-fan affinity
- reproducing signed-in personalization depth
- replacing contributor-scale observatory data

Quality expectations:

- compare synthetic-vs-contributor paths separately when evaluating model lift
- annotate analyses so synthetic sessions are not silently mixed into human-contribution claims
- use repeated capture runs rather than overfitting to a single session
- monitor platform UI drift because DOM changes can reduce parser quality quickly

## Operational Risks

- Platform terms may restrict automated browsing or scraping even for research use.
- YouTube UI changes may silently degrade selectors and lower capture quality.
- Logged-out sessions will not fully represent deeply personalized recommendation states.
- Signed-in research-account mode carries higher policy, enforcement, and account-integrity risk than signed-out mode.
- Region simulation via locale and `gl`/`hl` parameters is directionally useful but not a perfect substitute for in-region network presence.
- High-volume automation can create rate-limit, bot-detection, or account-integrity risk if operators move beyond the logged-out baseline.
- Local authenticated ingest tests also depend on the database role having permission to run Prisma migrations and create tables in the configured schema.

## Recommended Rollout

1. Start with YouTube only.
2. Run low-volume logged-out captures across the full 8x10 matrix.
3. Check each run's `run-summary.json` for missing cells, low search-result counts, and low recommendation density.
4. Add QA checks for selector drift before increasing volume.
5. Only consider signed-in synthetic research accounts after a separate policy review and explicit labeling plan.
6. If signed-in research accounts are approved, follow [HEADLESS_RESEARCH_ACCOUNTS.md](./HEADLESS_RESEARCH_ACCOUNTS.md) and keep the account pool manual, low-volume, and passive-only.
