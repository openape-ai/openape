# Active work

Updated 2026-09-07. This is a handoff index, not an assumption that an old branch
still matches live main. Re-read the plan and Git refs at session start.

| Work | Issue / plan | Checkout | Verified evidence | Next step |
|---|---|---|---|---|
| Restricted-session toolchain | [Issue #1343](https://git.openape.ai/openape-ai/openape/issues/1343) | `openape-monorepo.worktrees/ai-workflow`, branch `fix/issue-1343-session-toolchain`, base `4914bb03` | pnpm launcher/cache failure reproduced with network and cache writes denied; direct pinned pnpm runs the project Doctor and dry-run. [Setup and evidence](../operations/session-toolchain.md). | Read the issue for PR and exact check/merge evidence; follow the toolchain setup in new restricted sessions. |
| AI workflow rollout | [Issue #1342](https://git.openape.ai/openape-ai/openape/issues/1342), [live approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M1X6QVHZ5HXR11C7T0SVW206) | `openape-monorepo.worktrees/ai-workflow`; final acceptance is a separate fresh clone `/tmp/openape-workflow-fresh`, branch `fix/issue-1342-local-startup` | Checkpoint `a4921e2f` (PR #19); M0–M6 complete. Sources/check runs in [rollout evidence](../operations/ai-workflow.md). New Tasks/ape-pr dev ports started successfully with isolated data. | Read the live plan for final PR, exact checks/merge and independent session outcome. If it is done, no rollout work remains; select a new task explicitly. |
| Existing CRM work | existing `feature/crm-variante-b` branch | original `openape-monorepo` checkout | Initial inspected HEAD `ea2ebc16`; unrelated untracked work preserved. | Resume only for an explicitly selected CRM task. |
| LLM pull queue specification | existing `spec/llm-pull-queue` branch | `openape-llm-pull-queue` linked checkout | Initial inspected HEAD `f740d0f0`; same Git repository, not another product repo. | Read its own diff and issue before continuing. |

Other registered worktrees are intentionally not labelled abandoned. Use
`git worktree list --porcelain` and inspect their status before deciding whether
to resume or remove them. Do not delete a worktree on the strength of this index.

At handoff, record the actual branch and SHA, PR URL, exact successful/failed
checks and their log paths, remaining blockers and the next concrete action.
