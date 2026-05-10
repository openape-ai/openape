---
"@openape/apes": minor
---

New agent tool: `bash`. Lets the LLM run shell commands on the agent host via `ape-shell`. Every command goes through the OpenApe DDISA grant cycle — auto-approved by a matching YOLO scope or push-notified to the owner for one-tap approval. Runs as the agent's macOS user, so file/network access is jailed to what that user can already see. Returns `stdout`, `stderr`, and `exit_code` (plus a `timed_out` flag if the wall-clock cap is hit).

Risk level in the troop tool catalog: `high`. Default-on for new agents (consistent with the "all tools enabled by default" behavior introduced in 1.18.0); owners can narrow per agent in the troop UI.

For repeated patterns (e.g. `git status` in a coding-helper agent's workspace) set up a YOLO scope so approvals don't pile up.
