# Release Metadata Centralization Design

## Goal

Remove hard-coded product naming from release scripts and tests, make `src-tauri/tauri.conf.json` the single source of truth for the user-facing application name, and automate version propagation from `package.json` into Tauri and Cargo metadata.

## Chosen Metadata Model

### Display Name

Use `src-tauri/tauri.conf.json.productName` as the only user-facing application name source.

Scripts and tests should derive:

- ZIP artifact names
- portable folder names
- display-oriented labels

from `productName`, after applying artifact-safe normalization where needed.

### Version

Use `package.json.version` as the only manually maintained release version source.

Before build/package steps, a synchronization script should write that version into:

- `src-tauri/tauri.conf.json.version`
- `src-tauri/Cargo.toml` `[package].version`

This keeps Tauri bundle metadata, Cargo package metadata, and script-generated artifact names aligned.

### Technical Names

Technical identifiers such as:

- `package.json.name`
- `src-tauri/Cargo.toml [package].name`
- `src-tauri/Cargo.toml [lib].name`

remain separate from the user-facing display name for now. Scripts should read them through helpers rather than assuming `tauri_agent`.

## Script Changes

- Add helpers in `scripts/common.ps1` for:
  - reading Cargo package metadata
  - getting the technical binary base name
  - getting the display name from Tauri metadata
  - getting the synchronized release version
- Add `scripts/sync-release-metadata.ps1`
  - reads `package.json.version`
  - writes the same version into `tauri.conf.json`
  - writes the same version into `Cargo.toml`
  - optionally refreshes window title from `productName` to keep display metadata aligned
- Call the sync script from the release/build entry points before compilation.

## Test Strategy

- Update `scripts/tests/release-scripts.tests.ps1` so expected archive names and executable paths are derived from metadata helper functions instead of `tauri_agent`.
- Add a script test covering version synchronization:
  - create temporary copies of `package.json`, `tauri.conf.json`, and `Cargo.toml`
  - run the sync helper on the temp files
  - assert that Tauri and Cargo versions match the package version afterwards

## Non-Goals

- Do not rename the current npm package or Cargo crate in this change.
- Do not change Python backend sidecar naming in this change.
- Do not remove historical MSI-oriented configuration.
