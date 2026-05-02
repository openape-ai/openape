---
"@openape/apes": minor
---

apes: auto-refresh expired tokens for every command (not just `ape-shell`)

`ape-shell` has always rotated stale tokens transparently via the ed25519 challenge-response or OAuth refresh-token flow. The other `apes …` commands didn't — `apes whoami`, `apes grants list`, `apes agents list`, etc. either showed `EXPIRED` or threw `401 Not authenticated` even when a refresh path was available.

The refresh now runs at CLI entry for every subcommand except the ones that genuinely shouldn't touch existing auth: `login`, `logout`, `init`, `enroll`, `register-user`, `dns-check`, `utils`, `explain`, `workflows`. Failure is silent — the actual command then surfaces a proper auth error if the token is genuinely unusable.

Internally: extracted `ensureFreshToken()` from `apiFetch` and called it from `cli.ts` before `runMain(main)`.
