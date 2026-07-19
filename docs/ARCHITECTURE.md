# Architecture

## Decision summary

One distributable plugin folder carries both native manifests. Host adapters remain thin; every
semantic rule lives in a shared, dependency-free runtime.

```text
UserPromptSubmit
  -> host adapter
  -> state store: materialize + pin
  -> completion gate: hold stimulus in memory
  -> hook context: causal capsule

completed visible reply
  -> Stop hook signal
  -> isolated native appraiser
  -> strict parser
  -> ordered atomic state commit
  -> dashboard/API + next prompt
```

## Modules

| Module | Owns | Must not own |
| --- | --- | --- |
| `runtime/kernel.mjs` | bands, ranges, decay, capsule, typed delta math | filesystem, host CLIs, HTTP |
| `runtime/state-store.mjs` | migrations, permissions, atomic files, locks, version, epoch, ledger | raw prompt storage |
| `runtime/completion-gate.mjs` | bounded metadata-only queue, 30-minute completion signal, ready-only ordering | raw prompt persistence |
| `runtime/owned-directory-lock.mjs` | owner-claimed queue/state serialization, safe stale reclaim and release | product state or prompt data |
| `runtime/reaction-worker.mjs` | appraiser orchestration and ordered commit | user-facing response |
| `runtime/appraiser.mjs` | Claude/Codex command construction, child isolation, and strict response parsing | paths from model output |
| `hooks/*` | host input/output adaptation and completion signaling | emotional NLU |
| `runtime/mcp-server.mjs` | explicit tools and dashboard launch | automatic prompt lifecycle |
| `runtime/status-presence.mjs` | explicit Claude status-line opt-in and owned-setting removal | silent host configuration or Codex tray claims |
| `dashboard/*` | live local instrument and versioned controls | state authority |

## Persistence

Each host gets a separate profile under its native plugin data directory. The store uses versioned
JSON, atomic write-and-rename, user-only permissions, an owner-claimed process lock, a 100-key
processed-stimulus ledger, a 90-entry typed trail, and a control epoch. Stale lock recovery has its
own exclusive claim so delayed contenders cannot move a replacement owner. No database or
background service is required.

The dashboard is a client of the same state service. Its separate `dashboard-preferences.json`
stores only the System/Light/Dark choice under the same private directory and lock; it never changes
the emotional state version. Browser storage is not an authority.

## Host adaptation

The manifests set an explicit host adapter. Hooks prefer the host-provided plugin-data path. MCP
processes are less uniform: Codex may omit `CODEX_HOME`, while Claude may leave a data placeholder
literal inside MCP environment values. The runtime therefore derives the same native data contract
from Codex's installed cache root or Claude's config home when a concrete plugin-data value is not
available. Tests and installed-host smokes prove that MCP controls and hooks converge on one profile
without writing into the source checkout or a legacy user-wide fallback.

The same `hooks/hooks.json` registers exactly one handler per event:

- `UserPromptSubmit`: pin, gate, and inject.
- `Stop`: completion signal only.

Multiple independent prompt hooks are forbidden because hosts may launch matching hooks
concurrently.

## Dashboard

The MCP `open_dashboard` tool launches a short-lived loopback server and returns/opens a tokenized
URL. Static UI requests require an exact Host. API requests additionally require an unguessable
one-time bearer token. The browser exchanges it for an HttpOnly, SameSite=Strict session cookie,
removes the fragment from the address, and sends the exact Origin on same-origin mutations. The
server applies strict JSON schemas and version preconditions, emits a strict CSP and no CORS
headers, loads no external resources, and exits after idle timeout.

The Codex manifest carries the official V for supported plugin/composer surfaces. Claude Code's
main status line is user settings, not a plugin default: the dashboard/MCP explicit opt-in copies a
small local renderer, refuses to overwrite an existing `statusLine`, and removes only its exact
owned command. Settings mutation preserves valid symlinks, serializes plugin writers under an
owner-claimed lock, and rejects a file changed by an external editor before atomic replacement.
The command treats its encoded script path as data rather than interpolated shell syntax. No plugin
code claims a host-independent OS tray.

## Deliberate non-parity

- Claude/Codex hook context cannot guarantee Viventium's exact provider-final-tail placement.
- This plugin has no voice, messaging channels, cross-agent handoff, or full cognitive-mind routing.
- Claude and Codex profiles do not sync automatically.
- Native-host appraisal uses the user's logged-in host, model routing, and quota rather than the
  full platform's model-provider orchestration.
- The lightweight package appraises each completed enabled turn; the appraiser returns `changes: []`
  when nothing meaningfully moves, rather than running the full platform's separate activation
  classifier.

These are declared boundaries, not silent fallbacks.
