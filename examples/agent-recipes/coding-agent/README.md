# coding-agent recipe

An autonomous coding agent: assigned issue → isolated worktree → edit →
verify → PR → policy-gated merge. Built on the `@openape/apes` coding
library (M1–M7) + orchestrator (`coding/coding-loop.ts`).

## Deploy

```bash
apes agent deploy <this-repo>@main \
  --param repo=https://github.com/openape-ai/openape.git \
  --param forge=github \
  --secret GH_TOKEN=ghp_xxx
```

For Azure DevOps use `--param forge=azure --secret AZ_PAT=xxx`.

## Division of responsibility

- **The LLM does the coding** — `file.edit`, `bash`, `verify`. It is NOT
  given `forge.pr.merge`; even a `gh pr merge` via `bash` needs a grant
  the agent doesn't hold, so it cannot self-merge.
- **The orchestrator owns policy** — branch + worktree, opening the PR,
  classifying the diff, the risk assessor + reviewer gate, and arming
  `--auto` (merge-when-green). Branch protection is the server-side CI gate.

## Safety

- The agent **opens PRs only** — it never merges changes or pushes directly
  to protected branches.
- All merges require explicit approval via the repository's merge policy
  (branch protection rules, CI checks, and/or human review).
- The agent operates in isolated worktrees and never modifies the default
  branch directly.

## Per-repo config: `.openape/coding.json`

Policy lives in the **target repo**, not in this recipe or the library:

```json
{
  "verifyCommand": "pnpm test",
  "branch": { "template": "fix/issue-{number}-{slug}", "defaultType": "fix" },
  "mergePolicy": {
    "autoMergeEnabled": true,
    "autoPaths": ["**/*.md", ".changeset/**"],
    "riskPaths": ["infra/**"]
  }
}
```

- `autoMergeEnabled` is **false** by default — auto-merge is opt-in.
- `riskPaths` is augmented automatically from the repo's deploy-workflow
  `paths:` filters + CODEOWNERS (you don't maintain a parallel list).
- The agent additionally judges risk semantically; either source escalates
  a change to "human approval required".

## Updating a deployed agent

Intent, tools, and schedules hot-update via the agent's normal `apes
agents sync` cycle (~5 min) — no destroy/respawn. To roll out a new
recipe version (or new capabilities), re-deploy at the new ref; deploy is
an upsert (see plan INT-4).
