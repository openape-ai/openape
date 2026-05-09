---
'@openape/nest': minor
'@openape/apes': minor
---

Mutating Nest endpoints (`POST /agents`, `DELETE /agents/:name`) now require DDISA grant tokens. New CLI commands:

- `apes nest spawn <name>` — provisions an agent via the Nest. Grant `command` is just `['nest','spawn']` (no name baked in), so a single human approval covers all future spawns. Trade-off: a compromised local process running as the human can spawn arbitrary agents under that grant. Acceptable because spawn is reversible (`apes nest destroy`) and creates auditable IdP records.
- `apes nest destroy <name>` — tears down an agent. Grant `command` IS per-name (`['nest','destroy','<name>']`) deliberately, so destroying any specific agent is its own approval — destructive ops keep tighter scoping.

`curl POST /agents` and `curl DELETE /agents/:name` without `Authorization: Bearer …` now return 401. Existing scripts that hit the Nest directly need to migrate to `apes nest spawn|destroy` or implement the grant flow themselves.

YOLO defaults extended with `nest spawn` (wildcard-name) and `nest destroy *` (per-name pattern).
