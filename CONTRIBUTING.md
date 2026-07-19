# Contributing

Thank you for helping make Viventium Feelings more useful, truthful, and safe.

## Before opening a change

1. Read `AGENTS.md`, `docs/PRODUCT_CONTRACT.md`, and the relevant architecture or compatibility doc.
2. Open an issue for changes to bands, ranges, decay, turn causality, privacy, or public interfaces.
3. Use synthetic, non-personal fixtures. Never include prompts, transcripts, credentials, local
   usernames, hostnames, or private paths.
4. Add a failing test before changing behavior.

## Verification

```sh
npm test
npm run validate
npm run qa:browser
```

Native Claude and Codex checks must use isolated configuration homes first. Browser changes require
real desktop and mobile viewport QA, keyboard navigation, a clean console, and a screenshot review.

By contributing, you agree that your contribution is licensed under Apache-2.0 and that required
third-party notices remain intact.
