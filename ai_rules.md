# AI agent rules for this repository

Instructions for any AI coding agent (Claude or otherwise) making changes to this app.

## Changelog & versioning

- Every change to the app (feature, fix, refactor, dependency bump, etc.) must be recorded in
  `CHANGELOG.md`, following [Keep a Changelog](https://keepachangelog.com/) format
  (`Added` / `Changed` / `Fixed` / `Removed` sections under each version).
- **One version bump per calendar day, not per change.** If this is the first change made today,
  bump the version (see below) and add a new `## [x.y.z] - YYYY-MM-DD` section at the top of
  `CHANGELOG.md`. If `CHANGELOG.md` already has an entry dated today, do **not** bump the version
  again — append your change to today's existing entry instead.
- Use semantic versioning (`MAJOR.MINOR.PATCH`):
  - `PATCH` for fixes and small tweaks.
  - `MINOR` for new features that don't break existing behavior.
  - `MAJOR` for breaking changes.
  - When in doubt, bump `MINOR`.
- The version number lives in exactly two places and must always match:
  - `client/package.json` (`"version"`)
  - `server/package.json` (`"version"`)
  Update both together whenever bumping.
- The version is displayed in the app's sidebar footer, sourced directly from
  `client/package.json` — no separate constant to keep in sync.

## Workflow checklist for every change

1. Make the code change.
2. Check whether `CHANGELOG.md` already has a section dated today.
   - No → bump `client/package.json` and `server/package.json` versions together, add a new
     dated section at the top of `CHANGELOG.md` describing the change.
   - Yes → add a bullet to today's existing section describing the change; leave the version
     number as-is.
3. Keep entries user-facing and concise — describe *what* changed, not implementation detail.
