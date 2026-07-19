# Release checklist

1. Update `CHANGELOG.md`, both plugin manifests, both marketplace entries, and `CITATION.cff` to the
   same version.
2. Run `npm ci`, `npm test`, `npm audit --omit=dev`, `npm run validate`, and `npm run qa:browser`.
3. Run both real native appraiser smokes and both full hook/Stop turn smokes with synthetic text.
4. Install, update, and remove the package through clean isolated Claude Code and Codex homes.
5. Verify off, abort, prompt-injection, conflict, corruption, timeout, decay, direct-feeling,
   keyboard, mobile, reduced-motion, refresh, pause, reset, and erase cases.
6. Record PASS, FAIL, PARTIAL, or BLOCKED for every acceptance case in a dated report under `qa/`.
7. Scan public files, staged diff, commit metadata, screenshots, and history for secrets, personal
   paths, private prompts, tokens, hostnames, and unsupported claims.
8. Obtain an independent engineering/security/UX review and resolve or explicitly record findings.
9. Tag the immutable commit, publish checksums, and repeat installation from the tag in a new
   directory before calling the release public-ready.

Vendor-directory acceptance is a separate gate. Do not call the independent marketplace flow
“one-click” until the native plugin browser actually exposes it.
