# ADR 001: One shared plugin for Claude Code and Codex

- Status: Accepted
- Date: 2026-07-18

## Context

Claude Code and Codex use different manifests and installation commands, but the feeling model, state contract, dashboard, and user promise are the same. Separate product repositories would duplicate sensitive behavior and invite semantic drift.

## Decision

Ship one host-neutral repository and marketplace package named **Viventium Feelings**. Keep one shared runtime and dashboard, with only the native Claude and Codex manifests and host launch arguments separated.

This release supports Claude Code and Codex surfaces. It does not claim to intercept ordinary conversations in the consumer Claude or ChatGPT applications.

## Alternatives considered

- Separate `claude-*` and `codex-*` repositories: rejected because fixes, state migrations, and behavioral definitions could diverge.
- A hosted ChatGPT app first: rejected because an app cannot transparently participate in every ordinary chat turn and would require remote state and authentication.

## Consequences

- A user can keep one mental model across both hosts.
- Claude and Codex state remain separate by default in their native plugin data directories.
- Compatibility differences must be documented rather than hidden behind different products.
