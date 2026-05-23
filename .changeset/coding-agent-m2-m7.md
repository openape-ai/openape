---
"@openape/apes": minor
---

Coding-agent pipeline (M2–M7): a `coding/` library + gated tools that take the agent from issue to mergeable PR.

- **M2 verify** (`coding/verify.ts`, tool `verify`) — runs the recipe's test/build command in a worktree via the gated path; non-zero exit blocks the PR/merge phase.
- **M3 forge** (`coding/forge.ts`, tools `forge.pr.create|merge|status`, `forge.issue.get`) — provider-agnostic PR/issue ops via a **pluggable adapter registry**. GitHub (`gh`) + Azure DevOps (`az`) ship built-in; `registerForge()` adds any other (GitLab/Bitbucket/Gitea/self-hosted) — no closed enum locking teams out. Merge supports `--auto` (merge-when-green) and never bypasses required checks.
- **M4 issue→task** (`coding/issue-task.ts`) — pure branch-name + run-prompt derivation from an issue/work-item.
- **M5 merge-policy** (`coding/merge-policy.ts`) — classifies a diff (chore/code/risk) and decides the merge gate (B+C-Overlay). **Secure by default**: ships NO opinionated path lists; `autoMergeEnabled` is false until a repo opts in via `.openape/coding.json` (`loadMergePolicy`). Risk/auto globs belong to the repo they govern, not this package. `derive-policy.ts` (`resolveMergePolicy`) augments risk paths from signals that already exist — deploy-workflow `paths:` filters + CODEOWNERS — so the risk surface is derived, not a parallel list that rots.
- **M6 budget** (`coding/budget.ts`) — per-task token + wall-clock budget with a kill-switch.
- **M7 review-gate** (`coding/review-gate.ts`) — gates auto-merge on an injected reviewer-agent verdict for code-class changes.

All shell-touching paths route through the shared gated `runApeShell`. Pure logic is unit-tested; orchestration into the runLoop/cron + the live reviewer-agent dispatch is the integration layer.
