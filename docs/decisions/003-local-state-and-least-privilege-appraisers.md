# ADR 003: Local state and least-privilege logged-in appraisers

- Status: Accepted
- Date: 2026-07-18

## Context

The lightweight plugin should work without a new account, API key, or hosted Viventium service. Reusing the user’s logged-in host offers the lowest-friction appraisal path, but a nested model must not inherit project tools, MCP servers, rules, web access, or broad filesystem access.

## Decision

Keep state on the user’s machine in the host-provided plugin data directory with user-only permissions, atomic writes, strict schema validation, bounded history, and explicit erase. The feature defaults off and a read of missing state creates nothing.

Run appraisal in a fresh temporary working directory with no session persistence, no tools or MCP, no web/network access, strict structured output, time and budget limits, and the narrowest host-supported filesystem permission profile. The main agent receives only the derived feeling capsule; raw prompts and Inner state are never included in audit logs.

## Alternatives considered

- Hosted state and appraisal: rejected for this release because it adds signup, secrets, data transfer, and operational dependency.
- An API key supplied by the user: rejected because it adds setup friction and secret management.
- Appraise inside the main agent: rejected because it mixes private state mechanics with the user task and cannot provide a clean future-turn boundary.

## Consequences

- No additional credential is required, but appraisal consumes the user’s Claude or Codex plan capacity.
- Offline, auth, quota, timeout, and model failures leave feeling values unchanged and appear as degraded health.
- Host authentication behavior is a compatibility dependency and is tested, not treated as a permanent vendor guarantee.
