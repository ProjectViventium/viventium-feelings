# Threat model

Status: release-gate model for `0.1.0`.

## Trust boundaries and assets

| Boundary | Untrusted input | Protected asset |
| --- | --- | --- |
| Host hook | hook JSON and user prompt | prompt availability, state causality |
| Appraiser | newest stimulus and model output | credentials, filesystem, network, state integrity |
| State store | persisted JSON and concurrent writers | local affect state, user control |
| MCP | model-selected tool name and arguments | explicit user settings and destructive controls |
| Dashboard | browser request and form values | local state and launch token |

Raw conversation content and existing host credentials are the highest-sensitivity assets. Feeling
integrity and user's ability to turn the feature off or erase it are the highest-availability and
control assets.

## Primary abuse cases and controls

- **Prompt injection asks the appraiser to use tools or leak files.** The child has no Claude tools;
  Codex runs ephemeral with ignored config/rules, both shell implementations disabled, web search
  disabled, non-interactive approvals, network disabled, and a filesystem permission profile
  limited to minimal runtime paths plus the empty temporary workspace. Any unexpected tool event
  invalidates output. The runtime accepts only closed typed operations and never executes
  model-selected text.
- **Malicious output attempts arbitrary state or UI markup.** Closed enums, unique-band checks,
  bounded deltas, clamp, and `textContent` rendering prevent command execution and script injection.
- **A stale worker overwrites a pause, reset, edit, or erase.** Every control advances a control
  epoch. Reaction commit requires the launch epoch and existing enabled state.
- **Concurrent reactions lose or duplicate updates.** A four-entry metadata-only queue preserves
  distinct overlapping turns while only completion-signalled jobs contend for one active appraisal
  slot. Keyed event IDs deduplicate retries. A PID-aware process lock, rebase, version counter, and
  bounded HMAC event ledger serialize commits. Lock release requires a random owner token; stale
  reclaim verifies owner liveness, token, and inode before and after the atomic tombstone rename. A
  live state lock is never reclaimed solely because it looks old; pending gates expire after the
  30-minute in-memory completion window.
- **Reaction coordination strips the foreground feeling context.** The prompt hook builds the
  capsule first and fail-opens only the optional gate/worker path, so key, queue, or launch failures
  cannot remove the already-built capsule from the current turn.
- **A hostile page calls the dashboard API.** Server binds only to loopback; static requests require
  an exact Host; a random in-memory launch token bootstraps an HttpOnly SameSite=Strict session;
  state-changing browser requests additionally require the exact Origin. There is no CORS
  allowlist or cross-origin credential access.
- **Local files disclose prompt content.** Gate files contain keyed identifiers and fixed metadata
  only. State and audit files are user-only. Erase cascades through state, jobs, audit, and key.
- **Unbounded cost or denial of service.** Hook input, stimulus, capsule UTF-8 bytes, HTTP body,
  child output, model time, active appraisal count, pending queue, audit, trail, ledger, and job age
  are capped. A retry cannot create a second paid call. The visible response never waits for appraisal.

## Residual risks

- Model providers receive the bounded stimulus through the user's authenticated host.
- The host may persist its own conversation or hook context. Local Feelings erase cannot remove
  host transcripts or provider records.
- Host CLI flags and plugin hook contracts can change; native version QA is required per release.
- Codex's beta filesystem permission profile is a host boundary, not a formally verified OS jail in
  this package; native version QA remains mandatory.
- Behavioral influence is probabilistic. Typed state integrity does not guarantee a particular tone.
- A user with access to the same OS account can read user-owned local state.
- On a shared OS account, the tokenized dashboard URL can briefly appear in the launcher process's
  argument list before the browser opens. The supported threat model is a single-user local profile;
  API authorization, SameSite cookies, Host checks, and exact-Origin checks still apply.

The product is a single-user local plugin, not a multi-tenant service or regulated-data processor.
