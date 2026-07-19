# Security policy

## Supported versions

Security fixes are provided for the latest tagged release. Pre-release builds are evaluation
software and should not be installed on shared or untrusted machines.

## Report a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private security
advisory flow for `ProjectViventium/viventium-feelings` and include:

- the affected version and host;
- a minimal reproduction using synthetic data;
- impact and required local conditions;
- whether any credential or private conversation content may have been exposed.

Do not include real prompts, transcripts, keys, or personal paths.

## Security properties

- The runtime is dependency-free Node.js ESM.
- Hook, HTTP, MCP, persisted state, and model output are validated at their boundaries.
- Model output is untrusted typed data; the runtime accepts no command, path, or tool instruction.
- Appraisers run in an empty temporary directory with tools, customizations, project rules, MCP,
  session persistence, and web search disabled or unavailable. Both Codex shell implementations are
  disabled; its residual filesystem profile is limited to minimal runtime paths plus the empty
  temporary workspace, with network off.
- Child execution has input, output, time, and cost bounds, and one profile can hold only one active
  appraisal slot.
- State uses user-only permissions, version checks, a control epoch, bounded idempotency, and atomic
  replacement.
- The dashboard binds only to loopback, validates Host, uses a per-launch bearer bootstrap and an
  HttpOnly SameSite=Strict session, and requires exact Origin on browser mutations.

These controls reduce risk; a prompt is still sent through the user's selected model provider. Read
the [threat model](docs/THREAT_MODEL.md) before deploying in a regulated or multi-user environment.
