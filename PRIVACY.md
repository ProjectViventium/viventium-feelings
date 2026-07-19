# Privacy

Viventium Feelings is local-first. It has no Viventium account, telemetry endpoint, analytics SDK,
advertising tracker, or hosted state database.

## What is stored locally

- nine Current and Nature values, half-lives, and enabled flags;
- selected profile and user-authored settings;
- up to 90 typed trail entries;
- up to 100 keyed event identifiers used for idempotency;
- one display-only Inner state line;
- fixed reaction health and audit metadata;
- one dashboard theme choice (`system`, `light`, or `dark`);
- short-lived completion-gate metadata and a random local coordination key.

Raw prompt text, assistant answers, transcripts, and authentication credentials are not written by
Feelings to its state, audit, queue, or dashboard files. Prompt text is handed to the isolated
appraiser through process memory after a completed reply. The host may retain its own conversation,
hook-context, model-request, or service records under the user's Anthropic or OpenAI settings;
Feelings does not control or erase those provider/host records.

## Model processing

Reactions use the Claude Code or Codex command already installed and authenticated on the device.
The newest user stimulus, current typed feeling state, Nature, the last ten typed trail events, and
the user's Reaction Cortex instruction are sent through that host's normal model channel. The
assistant's completed answer and previous Inner state are excluded.

This processing is governed by the user's relationship and settings with Anthropic or OpenAI, not
by a separate Viventium service. It may consume the host account's quota.

## Dashboard

The dashboard runs on a random loopback port, loads no external resources, and uses a random token
held in the launch URL fragment. The browser sends it once as an authorization header, copies the
same random value into an HttpOnly SameSite=Strict loopback session cookie, and immediately removes
the fragment from the address and browser history.

## Controls

- **Pause** keeps state but stops context injection and appraisal.
- **Reset** returns Current to Nature and keeps the trail.
- **Erase** deletes state, trail, audit, completion gates, quarantine/recovery files, dashboard
  metadata, local keys, and the exact Viventium-owned Claude status line when present. It cannot
  erase the host's own chat/transcript or provider records and never changes another status line.

The optional Claude Code status-line action is a separate explicit host-setting change. Enabling it
adds a Viventium-owned command to Claude's `settings.json` and a local renderer under the Claude
config directory. It refuses to overwrite another status line. **Remove** deletes that exact command
while preserving Feelings data. **Erase everything** discloses and removes both local Feelings data
and that owned command; it never rewrites a foreign status line.

Claude Code and Codex use separate host-provided plugin data directories. No automatic sync occurs.
