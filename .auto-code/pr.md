# pr — openape-monorepo

Two review surfaces: an **ape-git PR** (the merge gate) + a **pr.openape.ai diff
review** (dogfooding). The loop never merges and never force-pushes. Base branch
is **`main`** (protected — branch + PR + green CI only).

Code lives on **repos.openape.ai** (ape-git) since 2026-08-29; git.openape.ai is a
mirror of it. Push and PR there. Issues stay on Forgejo — ape-git has no tracker.

Avoid German curly quotes „ " in any JSON (they break parsing).

## (a) Push
`git push -u apegit <branch>` (remote `apegit` → repos.openape.ai/patrick/monorepo).
**Push proof (mandatory):** `git ls-remote --heads apegit <branch>` must print the
just-pushed SHA. A "pushed" report without this check is a false report.

## (b) Diff review (pr.openape.ai, dogfooding — best-effort)
If `ape-pr` is unavailable or its upload fails, **skip this and note "diff review skipped" in the PR body** — it must never block shipping. The ape-git PR (c) is the real merge gate.
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

## (c) ape-git PR — the merge gate
ape-git is a DDISA SP, so the raw `apes` token is rejected: exchange it for an
SP-scoped bearer first. Create via the API:
```
BEARER=$(node --input-type=module -e "
  import { getAuthorizedBearer } from '@openape/cli-auth'
  process.stdout.write(await getAuthorizedBearer({ endpoint: 'https://repos.openape.ai', aud: 'repos.openape.ai' }))
")
curl -fsS -X POST "https://repos.openape.ai/api/repos/patrick/monorepo/pulls" \
  -H "Authorization: $BEARER" \
  -H "Content-Type: application/json" \
  -d '{"source":"<branch>","target":"main","title":"<branch>","body":"<body>"}'
```
Note the field names: ape-git takes `source`/`target`, not Forgejo's `head`/`base`.
PR **body**:
```
<one-line what+why>

Task: <ape-task url>

Diff review: <review-url>

Verifikation: <only checks that actually ran, with their observed result>
RED-Beweis: <captured failure output for bugfixes — see verify.md proof rules>
Nicht abgedeckt: <the limit of the proof — what was NOT verified and why>
```
"Nicht abgedeckt" is mandatory, never empty: name the boundary of the evidence
(e.g. "browser path only code-read; not executable in node"). It makes the report
falsifiable instead of self-congratulatory. Never claim a check whose output you
don't have, and never link services that don't exist.
(For a UI task, add the Coolify preview URL + a line that the visual review passed once the preview is up — see `verify.md`.)

## (d) Hand back
Move the ape-task to the **Review** lane and **always set `--context-url` to the Forgejo PR URL** — the merge→done reconciler keys on it:
```
ape-tasks edit <id> --lane Review --context-url <ape-git-pr-url> --notes "review: <review-url> — <summary>"
```
**No duplicate links:** the Forgejo PR URL lives in `--context-url` — do **not** repeat it in `--notes`. Notes carry only the summary (plus the diff-review URL, which isn't elsewhere on the task). If there's no separate review URL, notes is just the summary.

The loop does NOT mark the task done. Once Patrick merges the PR, the `auto-code-pr-reconcile` cron (launchd, ~5 min) moves the task to Done automatically. Return `outcome: shipped`.

**Duration writeback:** start the notes with `took ~<n>min` (actual wall time for
the task). Over time the board becomes sortable by real effort, not guesses.

## (e) Retro — the loop improves through Patrick, not by self-editing
If during the run a profile rule (`.auto-code/*.md`) proved wrong, misleading, or
missing, do NOT edit it mid-task. Propose the change as its own tiny follow-up PR
touching only `.auto-code/`, with one line of evidence from this run ("rule X cost
Y because Z"). No observation → no retro PR; this is for earned lessons, not
ceremony.
