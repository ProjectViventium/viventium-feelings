# Dashboard acceptance cases

| ID | User action | Expected result | Forbidden result |
| --- | --- | --- | --- |
| DSH-001 | Open tokenized local URL | Nine ordered lanes, Inner state, health, profile, and live timestamp are visible | Blank state, external asset, token in visible history |
| DSH-002 | Toggle off then refresh | Off persists; context/appraisal controls show paused | Re-enabled on read or refresh |
| DSH-003 | Resume | On persists and rails remain readable | State reset or trail loss |
| DSH-004 | Open a band, tune Current/Nature/half-life/enabled and five optional range additions, save | One atomic versioned change appears immediately; profile becomes Custom | Partial range save, stale Inner state, prompt text persisted |
| DSH-005 | Apply Warm profile | Consequence confirmation appears; all Nature and Current values change | Apply without confirmation |
| DSH-006 | Edit Reaction Cortex instruction | Count and saved value persist after refresh | More than 4,000 chars or unsafe HTML |
| DSH-007 | Reset | Confirmation appears; Current returns to Nature; trail remains | Nature changes or trail erased |
| DSH-008 | Erase | Destructive confirmation; all local state/key/audit/jobs and exact owned Claude V presence disappear; next read is off | State silently recreated, enabled, stale owned status line, or foreign status line changed |
| DSH-009 | Concurrent dashboard write | First write wins; stale write gets conflict and refresh guidance | Last-write-wins data loss |
| DSH-010 | API without token / wrong Origin / wrong Host | `401` / `403` / `421`; no state body | CORS access or token bypass |
| DSH-011 | Navigate only by keyboard | Logical focus, visible focus ring, operable dialogs and sliders | Focus trap escape or unlabeled action |
| DSH-012 | 320, 768, 1024, 1440 px | No horizontal loss; primary values and controls remain usable | Clipped actions or overlapping text |
| DSH-013 | Reduced motion | Stagger, pulses, and animated transitions collapse | forced motion |
| DSH-014 | Network interruption | Visible connection status and recovery | blank page or repeated error spam |
| DSH-015 | Inspect console/network | Zero console errors/warnings; only same-origin local requests | telemetry or external network request |
| DSH-016 | Open a newly installed, never-enabled profile | Disclosure explains local state, host processing, quota, and provider retention before any enable action | silent enable, state creation on read, or hidden processing disclosure |
| DSH-017 | Health changes between two degraded causes without a state version change | Polling replaces sign-in guidance with usage-limit guidance immediately | stale cause from the prior degraded reaction |
| DSH-018 | Send numeric strings, null Current, truthy reset flags, or nested range objects to mutation APIs | `422` and no state creation or coercion | silent zero, truthy action, or `500` |
| DSH-019 | View or edit a lane where Now equals Nature | Both numeric values and distinct markers remain visible; pressing Nature moves Nature only | inferred baseline, overlapping inaccessible control, or Current moves |
| DSH-020 | Press one slider key, wait for commit, then blur | Exactly one state version/control epoch advances | duplicate blur commit or cancelled in-flight reaction |
| DSH-021 | Leave one lane focused while decay, health, or a reaction changes elsewhere | Polling continues; other lanes, version, Inner state, health, and trail update; focused lane is not repainted | whole-dashboard polling freeze or stale 409 base |
| DSH-022 | Lose network during lane and range edits | Lane rolls back to authoritative value; typed range draft remains for retry | false saved value or discarded text |
| DSH-023 | Start a touch drag and let the browser claim vertical scroll | `pointercancel` restores both values and commits nothing | scroll mutates state |
| DSH-024 | Follow system theme, choose an override, close server, reopen on a new port | System follows OS; override applies before paint and survives host-profile relaunch | dark-only UI, flash, or port-scoped preference loss |
| DSH-025 | Inspect branding and semantics | Exact website V loads locally; no atom/lemon; natural button/slider semantics; polling grid is not a live region | approximate logo, external asset, low-contrast essential label, or repeated nine-lane announcement |
| DSH-026 | Add/remove host presence | Codex reports native V metadata; Claude explicit opt-in appears/removes and refuses to overwrite an existing status line | favicon called a tray icon, silent settings mutation, or custom line loss |
| DSH-027 | With Now equal to Nature, drag the upper half of the Now dot | Current moves and Nature does not; the Nature halo cannot steal the press | baseline changes when the user grabbed Now |
| DSH-028 | Press an arrow on Now, then begin a pointer drag before the keyboard debounce expires | Exactly one write commits and the visible value equals persisted state | double write, mid-drag commit, or UI/store divergence |
| DSH-029 | Keep a profile action focused through a poll, then save a focused advanced field | Focus survives the poll and returns to the equivalent field after the full render | focus falls to body or an unrelated control |
| DSH-030 | Erase on Claude with owned, orphaned, foreign, or unsafe status presence; erase on Codex | Host-specific scope is visible; owned/verified orphan residue is removed; foreign/unsafe paths survive; exact outcome remains visible after erase; Codex identity is deferred to uninstall | hidden toast, generic overclaim, custom-path deletion, or silent residue |
