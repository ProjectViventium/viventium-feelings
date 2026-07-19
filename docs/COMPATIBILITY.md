# Compatibility

| Surface | Automatic state | Reactions | Dashboard | V presence | Status |
| --- | --- | --- | --- | --- | --- |
| Claude Code CLI | Yes, through trusted hooks | Native isolated Claude appraisal | Local companion | Explicit non-overwriting status-line opt-in | Target |
| Claude Desktop Code, local/SSH | Yes, through trusted hooks | Native isolated Claude appraisal | Local companion | Explicit non-overwriting status-line opt-in | Target |
| Codex CLI | Yes, through trusted hooks | Native isolated Codex appraisal | Local companion | Plugin identity; no arbitrary TUI segment | Target |
| Codex in ChatGPT desktop | Yes, through trusted hooks | Native isolated Codex appraisal | Local companion | Native plugin/composer V metadata | Target |
| ChatGPT Work web | No local hook interceptor | Only explicit remote app calls | Hosted Apps SDK only | — | Separate future lane |
| ChatGPT Chat | No | No | No | — | Unsupported |
| Claude consumer chat | No | No | No | — | Unsupported |
| Codex IDE extension | Current plugin availability is not promised | — | — | — | Unsupported until proven |

Installation currently requires adding the Project Viventium marketplace and installing the plugin.
True single-click directory installation depends on vendor review and marketplace acceptance. Codex
also requires explicit trust for command hooks. Node.js 20.11+ is a `0.1.x` prerequisite until signed
self-contained binaries exist.

Restart Claude Code or Codex after updating. An already-running hook process does not gain the
new release's runtime fixes until the host starts the updated plugin.

The plugin permits one active reaction appraisal and four pending reactions per host profile. Rapid
overlapping turns still receive the latest committed feeling capsule; ready appraisals run in a
bounded order after completed replies without an incomplete older job holding the slot. The
in-memory completion window is 30 minutes, after which an unfinished turn is safely skipped. The
capsule is capped at 2,400 UTF-8 bytes in every reachable
range so it remains whole inside the smaller Codex hook-context budget.
