---
"@openape/apes": patch
---

fix(agent deploy): collect repeated `--param`/`--secret` flags from raw argv

citty 0.2.2 coerces a repeated `type:'string'` flag to its last value only,
so `apes agent deploy --param repo=… --param forge=…` silently dropped every
param but the last and troop rejected the deploy with "missing required
param". Deploy now parses all occurrences straight from `ctx.rawArgs`. Also
bind supplied secrets even when no capability is strictly required, so
optional capabilities passed via `--secret` are still sealed to the agent.
