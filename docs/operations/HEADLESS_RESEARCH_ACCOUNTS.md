# Headless Research Accounts

This document governs the signed-in research-account capability in RESMA's headless capture layer.

## Why This Exists

Signed-out browsing should remain the default for headless observatory capture. Some recommendation studies may still require signed-in observation to compare recommendation drift, account-history effects, or platform differences that do not appear in public mode.

Research accounts exist to support that narrow research need without turning RESMA into a general social automation framework.

## Allowed Use

Governed research accounts may be used for:

- passive browsing and recommendation observation
- opening watch/detail pages
- scrolling and repeat navigation patterns needed to observe recommendation changes
- low-volume, explicitly authorized observatory capture

## Not Allowed

This mode does not allow:

- automated account creation
- fake identity farming
- posting, uploading, replying, messaging, or commenting automation
- liking, following, subscribing, or growth automation
- impersonation, deceptive personas, or surprise operator behavior
- hidden hooks for future engagement automation

## Governance Model

Research-account mode is intentionally harder to use than signed-out mode.

Required controls:

- explicit CLI opt-in with `--enable-governed-research-account-mode`
- local config file identifying the manually provisioned account pool
- allowlisted platform support only
- `active` account status required for use
- `orchestrated` run scope required for CLI-driven matrix runs
- passive-observation-only capture mode required

The example config lives at [packages/headless/research-accounts.example.json](/C:/Users/jonas/Documents/RESMA-main/RESMA-main/packages/headless/research-accounts.example.json). It starts conservative on purpose: `paused` and `local-manual-only`.

## Manual Provisioning Only

Account creation must be manual.

Credential handling rules:

- keep credential sources local
- do not commit real account config files to Git
- do not store plaintext passwords in repo files
- prefer references to manually prepared browser user-data directories

## Operational Expectations

When research-account mode is used:

- signed-in use should be reviewed against platform policy and enforcement risk first
- operators should understand that account integrity risk is higher than signed-out mode
- output artifacts should remain separate from signed-out synthetic runs
- session metadata should explicitly mark research-account captures for downstream analysis

## Current Scope

Current implementation scope is intentionally narrow:

- allowlisted platform: `youtube`
- supported credential source: manually prepared persistent user-data directory
- supported behavior: passive observatory capture only

Anything broader should require a separate review, not a quiet extension of this path.
