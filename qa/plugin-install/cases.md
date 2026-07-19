# Plugin install acceptance cases

| ID | Surface | Expected result | Evidence |
| --- | --- | --- | --- |
| INS-001 | Claude strict validation | Plugin and marketplace pass with warnings treated as errors | CLI output |
| INS-002 | Claude isolated marketplace install | `viventium-feelings@project-viventium` installed and enabled | isolated plugin list |
| INS-003 | Codex isolated marketplace install | Plugin installed/enabled with `ON_USE` auth policy | JSON install output and list |
| INS-004 | Missing Node 20 | Installation docs disclose prerequisite; hooks fail open | version fixture/manual inspection |
| INS-005 | Untrusted Codex hooks | User receives trust gate; main host remains usable | native host run |
| INS-006 | Uninstall after erase | Plugin removed and local Feelings data absent | isolated remove + filesystem check |
| INS-007 | Update/restart | Version and plugin content refresh without state loss | isolated upgrade fixture |
| INS-008 | Native MCP opt-in in each host | Get-state returns absent/off v0; versioned enable writes only that host's plugin-data directory | fallback state in source tree, another profile, or user-wide legacy path |
| INS-009 | Native completed turn in each host | Hook capsule, visible reply, Stop, and healthy asynchronous reaction all execute from the installed package | source-only smoke or simulated tool call |
