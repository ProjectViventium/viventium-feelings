# Changelog

All notable changes to Viventium Feelings are documented here. This project follows Semantic
Versioning once the first public release is tagged.

## [0.1.1] - 2026-07-19

### Fixed

- Closed a stale-lock reclamation race where several delayed contenders could move a newly acquired
  queue or state lock after validating the same old directory.
- Unified queue and state writes on an owner-claimed directory lock that revalidates after atomic
  rename, releases through owner-specific tombstones, and recovers an abandoned reclaim claim.
- Preserved the original concurrent-queue regression and added fresh crashed/live reclaimer and
  tombstone-cleanup coverage; the suite now contains 81 tests.

## [0.1.0] - 2026-07-18

### Added

- Shared Claude Code and Codex plugin package with native marketplace manifests.
- Persistent nine-band Feelings kernel, per-band decay, typed reactions, and future-turn causality.
- Isolated native Claude/Codex appraisers with strict typed output and bounded execution.
- Local dashboard, Nature profiles, per-band and five-range tuning, reaction trail, health, pause,
  reset, and durable erase.
- Explicit local MCP controls, product contract, privacy policy, threat model, and acceptance suite.
