# Changelog

All notable changes to Viventium Feelings are documented here. This project follows Semantic
Versioning once the first public release is tagged.

## [0.1.3] - 2026-07-19

### Fixed

- Restored the owner-approved Reaction Cortex default so strength matches how much the moment
  matters instead of biasing appraisal toward the minimum category.
- Added an exact legacy-default migration: the formerly shipped weak default upgrades on read while
  every custom user instruction remains unchanged.
- Made **Erase everything** remove an explicitly installed Viventium-owned Claude status line from
  both dashboard and MCP erase flows. Foreign status lines remain untouched, and partial cleanup is
  reported without undoing the completed data erasure.

### Changed

- Clarified erase/uninstall guidance, privacy boundaries, threat handling, and release acceptance
  around owned host presence.
- Synchronized every package, marketplace, host manifest, citation, and MCP version surface at
  `0.1.3`.

## [0.1.2] - 2026-07-19

### Changed

- Redesigned the dashboard around inline lane editing: Current and Nature are now adjusted directly
  on each band lane (drag or keyboard), with a live readout and no modal for the fundamental
  interaction. Return speed (half-life), include-in-Feelings, and the five range additions moved to a
  one-click inline drawer per lane.
- Reskinned to a restrained, frontier-lab-aligned palette. Removed the lime/lemon global accent;
  saturated color is now reserved for each band's own identity. Chrome is monochrome ink/paper.
- Added system light/dark theme sync (`prefers-color-scheme`) with an explicit System/Light/Dark
  override persisted in private host plugin data across random-port relaunches, with no flash.
- Replaced the atom-style glyph with the exact Viventium website **V** asset; the wordmark now reads
  as the product and the active host (Claude Code / Codex) shows as a badge.
- Added the V to supported Codex plugin/composer metadata and an explicit, reversible Claude Code
  status-line option that refuses to overwrite another status line.

### Fixed

- A full dashboard re-render while a lane field held focus could leave background polling suspended
  (browsers fire no focusout for removed nodes); the focus ledger is now reconciled after re-renders.
- Focus and pending writes now use separate lane ledgers, so keyboard traversal among several
  controls in one lane cannot leave that lane permanently shielded from later remote reactions.
- Polling now continues while a lane remains focused, updating reactions, health, decay, trail,
  version, and all other lanes without repainting the active lane.
- Rapid inline edits across lanes are now serialized client-side so they cannot race their own
  `expectedVersion` into a spurious conflict.
- A keyboard edit now commits exactly once; a later blur cannot repeat the version/control change.
- Coincident Now/Nature hit regions now resolve against the marker rows, so Nature's larger halo
  cannot steal a press on the visible Now dot.
- A pointer drag now supersedes a pending keyboard debounce on the same thumb without a double
  commit or visible/persisted divergence.
- Profile actions retain keyboard focus across polls, advanced fields regain equivalent focus after
  saved full renders, and the freshness clock no longer creates repeating screen-reader chatter.
- Failed lane writes roll back optimistic values, and failed range saves keep the user's draft.
- Now and Nature have explicit numeric readouts and independently pressable markers even when equal.
- A touch scroll gesture that starts on a lane track can no longer mutate the feeling: tracks use
  `touch-action: pan-y` and a browser-claimed `pointercancel` reverts the drag instead of committing.
- Removed the polling grid's live-region behavior, restored native profile-button semantics, raised
  essential-label contrast, and increased direct marker distinction.
- Hardened Claude's optional status-line setup: shell metacharacters in config paths remain data,
  valid settings symlinks stay intact, concurrent plugin writers serialize, and a settings file
  changed by another editor is rejected instead of overwritten. Temporary settings writes are
  synced before their guarded rename.
- Corrected status-line health wording so a disabled system is `paused`, an untouched enabled
  system is `waiting`, and queue pressure or a completion timeout is `needs attention` rather than
  a false pause.
- Strengthened MCP mutation metadata and the dashboard's HTML-sink regression guard.
- Kept the active Claude/Codex host visible on mobile instead of hiding the host badge.

### Notes

- 96 unit tests plus the real-Chromium browser QA gate cover the redesign, host presence,
  exactly-once/polling/failure regressions, cross-port theme persistence, responsive layouts, and
  local-only behavior. `docs/UX_DESIGN.md` codifies the ratified contract.

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
