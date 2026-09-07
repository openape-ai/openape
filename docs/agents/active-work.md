# Active work

Updated 2026-09-07. This is a handoff index, not an assumption that an old branch
still matches live main. Re-read the plan and Git refs at session start.

| Work | Issue / plan | Checkout | Verified evidence | Next step |
|---|---|---|---|---|
| AI workflow rollout | [Issue #1342](https://git.openape.ai/openape-ai/openape/issues/1342), [approved plan](https://plans.openape.ai/teams/01KPV1XN2S4FEGHFVPR3ZZ7VN1/plans/01M1X6QVHZ5HXR11C7T0SVW206) | `openape-monorepo.worktrees/ai-workflow` and `ai-workflow-policy` | M0–M3 complete. [PR #17](https://repos.openape.ai/patrick/monorepo/pulls/17) passed all external suites on dbaea29a. [PR #18](https://repos.openape.ai/patrick/monorepo/pulls/18) passed all external suites on bdfa60c7; merged/deployed as 3f52d59a. | M4 isolated acceptance is in progress; finish production policy activation, merge context/CLI/doctor branch, then run the fresh-checkout port fix. |
| Existing CRM work | existing `feature/crm-variante-b` branch | original `openape-monorepo` checkout | Initial inspected HEAD `ea2ebc16`; unrelated untracked work preserved. | Resume only for an explicitly selected CRM task. |
| LLM pull queue specification | existing `spec/llm-pull-queue` branch | `openape-llm-pull-queue` linked checkout | Initial inspected HEAD `f740d0f0`; same Git repository, not another product repo. | Read its own diff and issue before continuing. |

Other registered worktrees are intentionally not labelled abandoned. Use
`git worktree list --porcelain` and inspect their status before deciding whether
to resume or remove them. Do not delete a worktree on the strength of this index.

At handoff, record the actual branch and SHA, PR URL, exact successful/failed
checks and their log paths, remaining blockers and the next concrete action.
