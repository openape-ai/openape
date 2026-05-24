---
"@openape/apes": patch
---

fix(forge): pass repo to issueGet so the poll can fetch issues pre-clone

The coding agent's poll calls `fetchIssue` BEFORE cloning the repo, but
the GitHub forge adapter built `gh issue view <n> --json …` with no
`--repo`, so `gh` tried to infer the repo from the (unrelated) CWD and
failed with `fatal: not a git repository`. `issueGet` (and `buildIssueGet`
/ `forge.issue.get`) now take the repo and emit `--repo <remote>`; the
poll passes its `--repo`. Azure work-items are org/project-scoped so the
arg is ignored there.
