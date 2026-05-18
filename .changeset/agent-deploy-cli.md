---
"@openape/apes": minor
---

New `apes agent deploy <repo>@<ref> [--param k=v] [--secret ENV=val]`
command: one-step Agent Recipe deploy. Calls troop's recipe-deploy
endpoint, waits for the agent to come online, then binds the declared
capability secrets (prompted interactively, or via `--secret` /
`--json`). The owner's `apes login` token authenticates.
