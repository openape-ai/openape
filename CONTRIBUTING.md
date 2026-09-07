# Contributing to OpenAPE

## Prerequisites

- Node.js >= 22
- pnpm (latest)
- An account on **repos.openape.ai** (ape-git) — the source of truth for code
- An account on **git.openape.ai** (Forgejo) — issues and CI live there (ape-git has no issue tracker)

## Setup

```bash
git clone https://repos.openape.ai/patrick/monorepo.git openape
cd openape
pnpm install
```

> **The source of truth is repos.openape.ai (ape-git)** since 2026-08-29 — push there.
> It mirrors to `git.openape.ai/openape-ai/openape` (Forgejo), which in turn mirrors to
> `github.com/openape-ai/openape`. Both are **copies**: never push to either.
>
> The split is not clean yet, so know which host does what:
>
> | Concern | Host |
> |---|---|
> | Code, branches, pushes | **repos.openape.ai** (ape-git) |
> | Issues | **git.openape.ai** — ape-git has no issue tracker |
> | CI (`CI / ci`) | **git.openape.ai** — Forgejo Actions, `.forgejo/workflows/` |
>
> If you cloned a mirror, repoint `origin`:
> `git remote set-url origin https://repos.openape.ai/patrick/monorepo.git`.

## Development Workflow

### 1. Pick an Issue

All work starts with an issue on git.openape.ai — issues stay on Forgejo because ape-git
does not have an issue tracker. Browse open issues:
https://git.openape.ai/openape-ai/openape/issues

### 2. Create a Feature Branch

Branch naming: `<type>/issue-<nr>-<short-description>`

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`

Example:

```bash
git fetch origin main
git checkout -b fix/issue-8-adapter-install origin/main
```

Claude Code users: `/issue-start 8` automates this.

### 3. Make Changes

- Run affected checks during development:
  ```bash
  pnpm turbo run lint typecheck --affected
  ```
- Run tests: `pnpm test`
- For app changes: `pnpm turbo run build --filter=<app>` and test locally

### 4. Commit

Definition of Done — these must pass before every commit:

1. `pnpm lint` — all projects clean
2. `pnpm typecheck` — no errors

The pre-commit hook enforces this automatically.

### 5. Create a Pull Request

```bash
git push -u origin <branch>
```

Then open the PR on repos.openape.ai — web UI, or `POST /api/repos/patrick/monorepo/pulls` with `{ title, body, source, target }` and a bearer from the SP token exchange (`@openape/cli-auth`'s `getAuthorizedBearer({ endpoint: 'https://repos.openape.ai', aud: 'repos.openape.ai' })`). `gh` works against neither host.

- Link the issue: `Closes #<nr>` in the PR body
- The **pre-push hook** runs the full gate (build + audit + lint + typecheck + test) locally before the push leaves your machine. Server-side CI is still **Forgejo Actions** on the git.openape.ai mirror (`.forgejo/workflows/`); this repo has no `.ape-ci.sh`, so ape-git's own webhook CI does not run for it. Emergency bypass of the local hook: `SKIP_HOOKS=1 git push`.
- Add a changeset if publishable packages changed: `pnpm changeset`

### 6. After Merge — Release

Versioning and publish are **local-only**. After your PR with a changeset lands on main, run from your machine:

```bash
git checkout main
git pull
pnpm release:local
```

Prepare the version bump on a feature branch with `pnpm version-packages`, then merge
that PR on repos.openape.ai. `pnpm release:local` publishes only from a clean main
checkout whose HEAD equals the canonical remote main and has no pending changesets.
It never creates a commit or pushes a branch. `pnpm release:local --dry-run` checks
these preconditions without publishing. Repository identity is defined once in
`.openape/repository.json`; deploy and push guards use the same configuration.

### 7. Deploy

Deploys run locally, as tested container images. `scripts/deploy-image.mjs` builds the app on your machine, packages the `.output` into an amd64 image, smoke-tests `/api/health` against that image, pushes it to `registry.openape.ai`, and only then lets chatty pull and swap the container — with an external health gate and automatic rollback to the previous tag:

```bash
pnpm run deploy:image troop                 # one target
pnpm run deploy:image tasks plans           # several at once
pnpm run deploy:image --all                 # every target
```

Targets: `free-idp`, `troop`, `chat`, `tasks`, `plans`, `testrun`, `timetrack`, `pr`, `monitor`, `question-service`, `dashboard`, `crm`. The documentation site has its own equivalent path, `pnpm run deploy:docs-site`.

Requires local SSH access to chatty (`openape@chatty.delta-mind.at`) and a `docker login` against `registry.openape.ai`.

**Emergency fallback.** The pre-container systemd units (`openape-<app>.service`) are still installed but disabled. `pnpm deploy <troop|chat|free-idp>` (`scripts/deploy.mjs`) is the path that feeds them — build → rsync to `releases/<TS>` → swap `current` → `systemctl restart` → health-check, with rollback on failure. Use it only when the container path is unavailable, and stop the container first: both bind the same port.

## Branch Policy

- **`main` is protected** — work on feature branches, open PRs on repos.openape.ai; the `CI / ci` check on the git.openape.ai mirror must be green before merge, and the local pre-push gate catches most failures before the push
- **Source changes on `main` are blocked** by pre-commit hook
- **Infrastructure exceptions** (direct-to-main OK): `.claude/`, `.github/`, `.githooks/`, `scripts/`, config files, docs
- **Emergency bypass:** `SKIP_HOOKS=1 git commit ...`

## Project Structure

```
packages/      — publishable libraries (@openape/*)
modules/       — publishable Nuxt modules
apps/          — deployable applications (private)
examples/      — example apps + E2E tests
```

See `.claude/CLAUDE.md` for the full dependency graph and tech stack details.

## DDISA Protocol

OpenAPE implements the DDISA protocol. Changes to protocol-relevant packages (core, auth, grants, nuxt-auth-idp, nuxt-auth-sp) must be checked against the spec in `openape-ai/protocol`. No silent deviations.
