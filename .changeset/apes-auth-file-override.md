---
'@openape/apes': minor
---

`APES_AUTH_FILE` env override for `loadAuth`/`saveAuth` (#1062)

Lets a wrapper run `apes`/`ape-shell` under an alternate identity file
instead of `~/.config/apes/auth.json`, without touching `HOME`. Built for
the worker's gated codex backend: the PreToolUse hook rewrites shell
commands to `APES_AUTH_FILE=<operator-auth> ape-shell -c <cmd>`, so grants
are requested by the operator agent (whose YOLO allow-list auto-approves
role tools) while every role tool keeps reading its config from the real
`HOME`. The override file's directory must already exist.
