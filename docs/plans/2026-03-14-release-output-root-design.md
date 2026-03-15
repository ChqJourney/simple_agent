# Release Output Root Design

## Goal

Move generated release artifacts out of the frontend build output tree so Vite cleanup cannot delete or lock portable packaging directories.

## Problem

The frontend build writes to `dist/`, while the portable packaging flow currently writes release artifacts under `dist/release/`. When `npm run build` runs again, Vite tries to clean `dist/` and collides with the already-created portable directory, causing `EBUSY` failures.

## Chosen Approach

Use a dedicated release artifact root outside `dist/`:

- `artifacts/release/<version>/portable/...`

All release scripts should derive this path through helpers in `scripts/common.ps1` instead of concatenating `dist/release` inline.

## Scope

- update release path helpers
- update portable packaging and release entry scripts
- update tests that assert release output paths
- keep frontend build output in `dist/`

## Non-Goals

- do not change frontend build configuration
- do not rename existing packaged artifacts
