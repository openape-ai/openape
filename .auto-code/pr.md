# pr — openape-monorepo

Two review surfaces: a **Forgejo PR** (the merge gate) + a **pr.openape.ai diff
review** (dogfooding). The loop never merges and never force-pushes. Base branch
is **`main`** (protected — branch + PR + green CI only).

Avoid German curly quotes „ " in any JSON (they break parsing).

## (a) Push
`git push -u forgejo <branch>` (remote `forgejo` → git.openape.ai/openape-ai/openape).

## (b) Diff review (pr.openape.ai, dogfooding — best-effort)
If `ape-pr` is unavailable or its upload fails, **skip this and note "diff review skipped" in the PR body** — it must never block shipping. The Forgejo PR (c) is the real merge gate.
- `git diff origin/main...<branch> > <dir>/diff.patch`
- write `<dir>/pr.json`:
  ```json
  {
    "title": "<branch>",
    "description": "<one-line what+why>\n\n[Task](<ape-task url>)",
    "branch": "<branch>",
    "authorAct": "agent"
  }
  ```
- `ape-pr upload <dir> --endpoint https://pr.openape.ai` → `<review-url>` (global npm `@openape/ape-pr`, same apes session).

## (c) Forgejo PR — the merge gate
Token: read the scoped token from `~/.config/openape/forgejo-token` (PR/read scope). Create via the API:
```
curl -fsS -X POST "https://git.openape.ai/api/v1/repos/openape-ai/openape/pulls" \
  -H "Authorization: token $(cat ~/.config/openape/forgejo-token)" \
  -H "Content-Type: application/json" \
  -d '{"head":"<branch>","base":"main","title":"<branch>","body":"<body>"}'
```
PR **body**:
```
<one-line what+why>

Task: <ape-task url>

Diff review: <review-url>
```
(For a UI task, add the Coolify preview URL + a line that the visual review passed once the preview is up — see `verify.md`.)

## (d) Hand back
Move the ape-task to the **Review** lane and **always set `--context-url` to the Forgejo PR URL** — the merge→done reconciler keys on it:
```
ape-tasks edit <id> --lane Review --context-url <forgejo-pr-url> --notes "review: <review-url> — <summary>"
```
**No duplicate links:** the Forgejo PR URL lives in `--context-url` — do **not** repeat it in `--notes`. Notes carry only the summary (plus the diff-review URL, which isn't elsewhere on the task). If there's no separate review URL, notes is just the summary.

The loop does NOT mark the task done. Once Patrick merges the PR, the `auto-code-pr-reconcile` cron (launchd, ~5 min) moves the task to Done automatically. Return `outcome: shipped`.
