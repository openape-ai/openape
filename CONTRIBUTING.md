# Contributing to OpenAPE

## Prerequisites

- Node.js >= 22
- pnpm (latest)
- An account on **git.openape.ai** (Forgejo) — issues and PRs live there

## Setup

```bash
git clone https://git.openape.ai/openape-ai/openape.git
cd openape
pnpm install
```

> **Canonical host is git.openape.ai (Forgejo)** — issues, PRs and CI all live there.
> `github.com/openape-ai/openape` is a **read-only mirror** (code only): never open issues/PRs
> or push there. If you cloned the mirror, point `origin` at Forgejo:
> `git remote set-url origin https://git.openape.ai/openape-ai/openape.git`.

## Development Workflow

### 1. Pick an Issue

All work starts with an issue on git.openape.ai. Browse open issues:
https://git.openape.ai/openape-ai/openape/issues

### 2. Create a Feature Branch

Branch naming: `<type>/issue-<nr>-<short-description>`

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`

Example:

```bash
git fetch origin main
git checkout -b fix/issue-8-adapter-install origin/main
```

Claude Code users: `/issue 8` automates this.

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

Then open the PR on git.openape.ai (the push prints a "Create a new pull request" link, or use the web UI / API). `gh` does not work against Forgejo.

- Link the issue: `Closes #<nr>` in the PR body
- The **pre-push hook** runs the full gate (build + audit + lint + typecheck + test) locally before the push leaves your machine. CI also runs server-side as **Forgejo Actions** on git.openape.ai — the `CI / ci` check must be green before merge. Emergency bypass of the local hook: `SKIP_HOOKS=1 git push`.
- Add a changeset if publishable packages changed: `pnpm changeset`

### 6. After Merge — Release

Versioning and publish are **local-only**. After your PR with a changeset lands on main, run from your machine:

```bash
git checkout main
git pull
pnpm release:local
```

This script (`scripts/release-local.mjs`) consumes pending changesets, bumps versions, builds, publishes to npm in dependency order, and pushes the version commit. Versioning and publishing happen entirely on your machine — there is no publish workflow on a CI server.

### 7. Deploy

Deploys also run locally. Each app has a `scripts/deploy-<app>.sh` (build → rsync to chatty → swap `current` → restart service → health-check); `scripts/deploy.mjs` wraps them with target selection and rollback-on-failure:

```bash
pnpm deploy troop            # deploy a specific app
pnpm deploy --changed        # deploy whatever changed vs origin/main
pnpm deploy --all            # deploy everything
pnpm deploy --dry-run troop  # show the plan, touch nothing
```

Requires local SSH access to chatty (`openape@chatty.delta-mind.at`) with passwordless sudo for `systemctl restart openape-*.service`.

## Branch Policy

- **`main` is protected** — work on feature branches, open PRs; the local pre-push gate stands in for server-side CI
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
