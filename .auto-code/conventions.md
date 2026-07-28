# conventions — openape-monorepo

## Commits
- Conventional commits (the repo's history uses `feat:`/`fix:`/`chore:`/`docs:` + optional scope, e.g. `feat(cli): …`).
- **No AI co-author**, no narration comments — self-documenting code.
- Code style: ESLint `@antfu/eslint-config` (no semicolons, single quotes), Composition API + `<script setup>`, Tailwind 4 + @nuxt/ui 4. Match surrounding code.

## Branch & worktree
- **Never edit `main` directly.** A Claude hook blocks source edits on `main` (exceptions: `.claude/`, `.github/`, `.githooks/`, `scripts/`, config). Always work on a branch in a worktree.
- Branch name: `<type>/<topic>-<task-short-id>` where `<type>` is the **long form** — `feature` · `bugfix` · `chore` · `refactor` · `style` · `docs` (e.g. `feature/agent-pause-8k46`, `bugfix/…`). Note this is the long form even though the commit uses the short conventional type (`feat:`/`fix:`). The short ape-task id keeps it unique so parallel agents never collide. The repo's native `<type>/issue-<nr>-…` naming is for Forgejo-issue work; auto-code tasks come from ape-tasks, so reference the **ape-task** in the PR body instead of a Forgejo issue number.
- Base branch: **`main`** (branch off fresh `origin/main`).
- Worktree: `git worktree add -b <branch> ../openape-monorepo.worktrees/openape-<type>-<topic>-<task-short-id> origin/main`, then `pnpm install` in the worktree. Remove when done.

## Links (no duplicates)
A URL that already appears in a text (task `context_url`, notes, the PR body) is **never entered again**. The Forgejo PR URL lives in the task's `context_url` — don't also repeat it in `notes`. Each link in exactly one place; the accompanying notes/PR text carries a summary, not a restated URL.

## Scope
- Very small PRs; start with the easiest tasks. Keep the diff minimal — one task = one branch = one PR.
- Scope to one package/app where possible (`turbo --filter`); `pnpm install` across the workspace is heavy — sequential default.
- A deeper blocker is its own escalated ape-task (move the original to `Blocked`), not extra commits here.

## Publishable packages (changesets)
If a change touches a **publishable** `packages/*` or `modules/*` (not an app), add a changeset (`pnpm changeset`) per CONTRIBUTING — publishing is local/manual, but the changeset must accompany the PR. App-only changes (`apps/*`) need no changeset.

## DDISA / security
Protocol-relevant or auth/grants/session/endpoint changes follow the DDISA compliance + security gates in `verify.md` — surface any spec deviation, never silently diverge.
