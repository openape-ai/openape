---
"@openape/apes": patch
---

fix(coding): set git identity + push auth, and check commit/push/PR exit codes

A freshly-spawned agent has no git identity, and `git push` over HTTPS
needs the forge token — so the coding loop's commit/push silently failed
and, because it didn't check exit codes, still reported `awaiting-human`
with no PR ever created. The loop now: commits with a default author
identity (overridable via `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`), pushes
through the `gh` credential helper (which reads the materialized
GH_TOKEN), and returns `run-failed` with the real error if commit, push,
or `pr create` fails — never a phantom PR.
