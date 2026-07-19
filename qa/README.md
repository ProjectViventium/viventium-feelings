# QA operating contract

Each user-facing flow has one living case list and dated results. Evidence must distinguish source
inspection, automated tests, native validator/install proof, real model proof, and visible browser
proof. None substitutes for another.

Use only synthetic state and prompts. Public reports must not contain local usernames, home paths,
hostnames, credentials, transcripts, or private strategy.

Status values are `PASS`, `FAIL`, `PARTIAL`, and `BLOCKED`.

## Release gate

1. `npm test` passes.
2. Claude strict plugin and marketplace validation pass.
3. Codex and Claude install from the repository marketplace in isolated homes.
4. Hook lifecycle smoke proves old-state injection and future-only reaction.
5. A real native appraiser run produces a schema-valid typed reaction without tool events.
6. Dashboard happy and unhappy paths run in a real browser at desktop and 320 px mobile.
7. Console, network, keyboard, reduced-motion, security headers, and persistence refresh checks pass.
8. Public/private leak scan passes.
9. Independent architecture/security/marketing review findings are resolved or explicitly blocked.
