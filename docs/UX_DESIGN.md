# Dashboard UX contract

Ratified 2026-07-19. Parent source of truth: the public Viventium core
[`54_Emotional_Cortex_And_Feeling_State.md`](https://github.com/ProjectViventium/viventium/blob/main/docs/requirements_and_learnings/54_Emotional_Cortex_And_Feeling_State.md)
and its timestamped decisions timeline; this file re-states the surface contract this dashboard
must satisfy.

## Visual thesis

A quiet, precise instrument that belongs beside frontier-model tools. Chrome is restrained
monochrome ink-on-paper in light and paper-on-ink in dark; typography is exact; Viventium's nine
band colors appear only as live data signals — never as chrome. There is no global action accent
color. The brand reuses the exact Viventium website **V** asset (`assets/viventium-v.png`) as both
the favicon and visible mark—never a hand-drawn approximation—with a product-forward wordmark:
small VIVENTIUM over bold **Feelings**, plus a host badge (Claude Code / Codex).

## Theme

The dashboard follows the operating system's light/dark preference by default
(`prefers-color-scheme`), with an explicit System → Light → Dark override stored in the host's
private plugin-data directory. The server injects that preference before first paint, so it survives
the dashboard's random-port relaunches without flashing. Both palettes are first-class.

## Interaction thesis

The fundamental interaction — seeing Current (Now) versus Nature and changing either — happens
**inline on the band lane itself**:

- Every lane is a dual-thumb track: a round Now thumb and a distinct raised Nature diamond, with the
  band's low/high pole words at the track ends and explicit numeric **Now** and **Nature** readouts.
- Pressing either marker chooses that exact marker—even when Now equals Nature. A rail press uses
  proximity. Drag either marker or focus one and use Arrow / PageUp / PageDown /
  Home / End. The readout, level word, and delta-vs-Nature update live; releasing (or a short
  keyboard pause) commits through the versioned API.
- A vertical-scroll gesture that the browser claims (`pointercancel`) reverts the drag; scrolling
  can never mutate a feeling. Tracks use `touch-action: pan-y` so the page still scrolls on touch.
- **No modal is used for tuning.** Advanced options — return speed (half-life), include-in-Feelings,
  and the five range-embodiment additions — live one click away in an inline expand drawer under the
  lane. Collapsed drawers are `inert`.
- Rows enter in a short stagger; a reaction-moved value pulses once; all motion collapses under
  `prefers-reduced-motion`.

Dialogs remain only where a consequence must be disclosed before a destructive or sweeping mutation:
profile apply, reset, erase, and the first-run privacy disclosure.

## Content plan

1. **Now:** all nine Current/Nature lanes, editable in place, and the private Inner state. A standard
   1440×900 desktop view shows the complete instrument; smaller surfaces scroll without clipping.
2. **Nature:** four transparent starting profiles with consequences stated before apply.
3. **Trail:** chronological typed changes without prompt content.
4. **Settings:** reaction instruction plus pause, reset, and erase controls.
5. **About:** one tasteful bridge to the full Viventium platform and its creator.

The dashboard is an operating surface, not a landing page. Marketing copy is confined to About.

## Resilience rules the UI must keep

- Background polls always fetch and update health, trail, Inner state, version, decay, and other
  lanes; they skip repainting only the lane being edited.
- Failed or conflicting lane saves restore the last authoritative value. Failed range saves keep the
  user's draft. A keyboard pause commits exactly once; later blur cannot commit the same change again.
- When keyboard input is followed immediately by a pointer gesture on the same thumb, the pointer
  gesture supersedes the keyboard debounce: one write commits, and pointer cancellation returns to
  authoritative state.
- Band commits are serialized client-side so rapid inline edits across lanes cannot race their own
  `expectedVersion`.
- A forced conflict refresh always fetches even while a lane is focused.
- Polling and full-render saves preserve the user's focused profile or equivalent advanced control;
  the freshness clock is not a repeating live-region announcement.

## Host presence

- Browser/window identity uses the website V favicon.
- Codex gets the V in supported plugin and composer surfaces through its native manifest.
- Claude Code offers a one-click, explicit status-line opt-in from Settings (and an equivalent MCP
  control). It refuses to overwrite another status line and removes only its owned command.
- Neither plugin claims to own an operating-system tray/menu-bar API the host does not expose.

## Information architecture preserved from full Viventium

The portable face lift keeps the underlying product grammar: nine ordered lanes, Now versus Nature,
motion, active range words, per-band tuning, Inner state, health, reaction trail, profile, reaction
instruction, reset, pause, and erase. It changes presentation, not affect semantics.

All controls are native or ARIA-complete (`role="slider"` with value text on both thumbs), every
action has a visible focus state, the layout is single-column by tablet width, and it remains usable
at 320 px.
