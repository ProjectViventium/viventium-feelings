# Viventium Feelings

This repository is the standalone, public plugin edition of Viventium Feelings.

## Outcome

Preserve the full Viventium Feelings experience while using the smallest native surface each host
provides. Quality means behavioral fidelity, privacy, usefulness, and honest platform claims;
performance means prompt injection stays local and appraisal never delays the visible reply.

## Product invariants

- Missing state is valid and defaults off. Reading must not create or enable state.
- A turn receives a pinned snapshot from before that turn. Its reaction may affect only a later turn.
- The nine bands, five ranges, per-band half-lives, `3/8/15` deltas, typed causes, 90-entry trail,
  10-entry appraisal context, and display-only Inner state are stable contracts.
- Runtime code never classifies emotion or intent with keywords or regular expressions.
- Raw prompts, transcripts, user-authored range additions, and Inner state never enter logs or
  public QA artifacts.
- Off means no capsule and no appraisal. Erase must remain erased after the next prompt and restart.
- Claude and Codex are separate local profiles unless a future explicit sync feature is added.
- Do not claim ordinary ChatGPT Chat or Claude Chat support. This release targets Claude Code and
  local Codex surfaces that execute plugin hooks.

## Repository boundaries

- `plugins/viventium-feelings/` is the distributable plugin root.
- `.agents/plugins/marketplace.json` is the Codex marketplace.
- `.claude-plugin/marketplace.json` is the Claude marketplace.
- `docs/` contains public product truth only.
- `test/` and `qa/` use synthetic, non-personal data.
- Internal research, raw captures, private strategy, private prompts, and machine-local evidence
  belong in the separate private companion repository.

## Engineering rules

- Use dependency-free Node.js ESM for the portable runtime unless a reviewed requirement proves a
  dependency is necessary.
- Validate every hook, MCP, HTTP, model, and persisted-state boundary.
- Keep appraiser children in an empty temporary directory with tools, web, plugins, rules, project
  instructions, and session persistence disabled.
- Use atomic file replacement, process-safe locks, stable event IDs, a control epoch, and bounded
  queues. Model output never chooses commands, paths, tools, or arguments.
- Bind the dashboard only to loopback. Require a random launch token for every API request; enforce
  Host, Origin, CSP, no-CORS, and idle shutdown.
- Use tests first for behavior changes. Run native plugin validation, the full Node suite, and real
  browser QA before release claims.

## Verification

Run:

```sh
npm test
npm run validate
npm run qa:browser
```

Native Claude and Codex install tests must use isolated homes before any active-scope test.
