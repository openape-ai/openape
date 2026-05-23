---
"@openape/apes": minor
---

Coding-agent primitives (M1): `edit_file` (structured substring replace, OS-confined to $HOME, no grant) and `git_worktree` (create/remove/list isolated worktrees under ~/work via the gated ape-shell path). Extracts the shared `runApeShell` gated-exec helper so every shell-touching tool routes through the same DDISA grant + shapes checkpoint. Both tools registered in the runtime registry + tool-catalog.json.
