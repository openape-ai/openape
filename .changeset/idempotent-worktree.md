---
"@openape/apes": patch
---

fix(coding): make worktree creation idempotent for the polling agent

The coding agent polls the same issue every tick, mapping it to the same
task id → same branch + worktree path. `git worktree add -b` then failed
on the second attempt with "a branch named '…' already exists", so a
re-poll could never make progress once a prior run left a worktree
behind. Creation now tears down any leftover worktree (remove --force +
prune + rm) and uses `-B` to create-or-reset the branch, so repeat
attempts start clean.
