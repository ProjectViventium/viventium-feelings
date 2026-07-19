# Remote release acceptance — 2026-07-18

Status: **PASS for the public GitHub release path.** Vendor-directory discovery remains a separate
future gate and is not described as one-click in this release.

All prompts and state used in validation were synthetic. Tests ran from a fresh clone of
`https://github.com/ProjectViventium/viventium-feelings.git` in isolated temporary host homes.

## Published candidate

- Repository: `ProjectViventium/viventium-feelings` (public)
- Candidate commit: `7813d5d1f50ecd2f31e1fdf09250fbb19b629ff9`
- GitHub Actions CI: **PASS**
- Visibility and default branch: public, `main`

## Fresh-clone gates

- `npm ci`: **PASS**; one-package audit reported zero vulnerabilities.
- `npm test`: **79 passed, 0 failed**.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- `npm run validate:static`: **PASS**.
- `npm run validate`: **PASS** for strict manifests plus isolated local Claude/Codex package
  lifecycle validation.
- `npm run qa:browser`: **PASS** in real Chromium. The run covered first-use/default-off, live
  decay, 320–1440 px layouts, keyboard and reduced-motion behavior, range/instruction persistence,
  profiles, pause/resume, failed-mutation rollback, recovery, reset/erase, local-only networking,
  and a clean normal-operation console.

## GitHub marketplace lifecycle

| Host | Add remote | Install/list 0.1.0 | Refresh/update | Remove/empty list |
| --- | --- | --- | --- | --- |
| Codex | PASS | PASS | PASS (`marketplace upgrade`) | PASS |
| Claude Code | PASS | PASS | PASS (`marketplace update` + plugin update) | PASS |

Codex reported the package as enabled with `ON_USE` authorization and a Git marketplace source of
`https://github.com/ProjectViventium/viventium-feelings.git`. Claude Code cloned over HTTPS,
validated the marketplace, installed version `0.1.0`, reported its MCP server, confirmed the
version was current, and removed it cleanly. Both lifecycles used new isolated data/config homes;
the user's regular host installations were not changed.

## Review and runtime evidence carried into release

- Visible Claude Desktop Fable 5 Extra review and follow-up: no remaining release-blocking or code
  correctness findings after remediation.
- Independent quiescent review: no remaining P0–P2 findings after remediation.
- Healthy installed-package completion/appraisal lifecycle previously passed on both Claude Code
  and Codex; the post-remediation Claude lifecycle passed again.
- The current Codex account is quota-exhausted. A fresh Codex appraisal therefore remains
  **BLOCKED by provider quota**, while the real degraded path is a **PASS**: `provider_rate_limit`,
  unchanged affect, and no raw content persisted. This is not relabeled as a healthy appraisal.

## Release conclusion

The GitHub install, update, removal, package, browser, security, and CI gates are green. The release
is ready to tag as `v0.1.0` after this evidence commit itself passes CI. Submission to a native
vendor directory, testing by a separate outside user/machine, and a new healthy Codex appraisal
after quota reset remain post-release confidence and distribution work—not hidden prerequisites of
the documented GitHub installation path.
