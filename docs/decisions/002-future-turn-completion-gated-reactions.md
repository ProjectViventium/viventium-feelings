# ADR 002: Completion-gated reactions affect only future turns

- Status: Accepted
- Date: 2026-07-18

## Context

An emotional reaction to a user prompt must not rewrite the reply already being produced. Starting independent hooks on prompt submission can race: appraisal may update state before the context hook has pinned the intended snapshot. Appraising an abandoned or failed turn would also create false emotional history.

## Decision

Use one prompt orchestrator to pin the pre-turn state and create one in-memory pending reaction. Return that pinned capsule to the main agent. Release the reaction worker only from the host `Stop` event after successful assistant output. Persist changes through an ordered, versioned commit with event deduplication and a control epoch.

The raw prompt is passed to the detached worker through process memory and standard input. It is not written to state, jobs, audit logs, or the dashboard.

## Alternatives considered

- Two independent prompt hooks: rejected because their execution order is not a safe causality boundary.
- Update state before the current reply: rejected because the current stimulus would influence its own response.
- Persist pending raw prompts: rejected because crash recovery is not worth the privacy cost.

## Consequences

- A reaction to turn N can influence turn N+1, never turn N.
- Cancelled, interrupted, or failed completions do not create feeling changes.
- Process termination can discard a pending reaction; this is a safe degradation and is surfaced in health rather than replayed from disk.
