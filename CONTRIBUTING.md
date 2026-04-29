# Contributing to OpenAPE

## Prerequisites

- Node.js >= 22
- pnpm (latest)
- GitHub CLI (`gh`)

## Setup

```bash
git clone git@github.com:openape-ai/openape.git
cd openape
pnpm install
```

## Development Workflow

### 1. Pick an Issue

All work starts with a GitHub issue. Browse open issues:
https://github.com/openape-ai/openape/issues

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
gh pr create
```

- Link the issue: `Closes #<nr>` in the PR body
- CI must pass before merge
- Add a changeset if publishable packages changed: `pnpm changeset`

### 6. After Merge — Release

Versioning and publish are **local-only**. After your PR with a changeset lands on main, run from your machine:

```bash
git checkout main
git pull
pnpm release:local
```

This script (`scripts/release-local.mjs`) consumes pending changesets, bumps versions, builds, publishes to npm in dependency order, and pushes the version commit. It replaces what used to be three sequential CI cycles (version-PR + post-merge CI + publish) with a single local pass — usually faster, and you skip the surface area for CI flakes.

The CI `release.yml` is the safety net: pushing a changeset to main without running `release:local` first will fail loudly instead of silently opening a version-PR.

## Branch Policy

- **`main` is protected** — no direct pushes, PRs + CI required
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
