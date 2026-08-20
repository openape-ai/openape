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

- **`main` is protected** — work on feature branches, open PRs; the `CI / ci` check on git.openape.ai must be green before merge, and the local pre-push gate catches most failures before the push
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
