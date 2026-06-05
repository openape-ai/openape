# Tested-Image Docker Deploy (Pilot: troop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, locally test, and prepare-to-deploy a multi-arch Docker image of `openape-troop` through a GHCR-first, registry-agnostic pipeline (`buildx` → GHCR → chatty `docker compose` behind unchanged nginx on port 3010 → health-check + rollback), so prod runs the bit-identical artifact verified locally.

**Architecture:** A multi-stage `apps/openape-troop/Dockerfile` builds the Nuxt/Nitro `.output` from the monorepo and ships a slim `node:22-bookworm-slim` runtime. `compose/chatty.yml` defines the `openape-troop` service (published on `127.0.0.1:3010`, env from a gitignored `.env.troop`, healthcheck on a new deterministic `/api/health` endpoint). `scripts/deploy-image.mjs` is a generic, parametrized deployer (mirrors `scripts/deploy.mjs`) that builds+pushes multi-arch, pins the deployed tag via the compose project's `.env`, pulls + `up -d` on chatty over SSH, health-checks, and rolls back on failure. The systemd `openape-troop.service` stays dormant as a fallback.

**Tech Stack:** Docker `buildx` (multi-arch arm64+amd64), GHCR (`ghcr.io/openape-ai`, registry-agnostic via `REGISTRY` var), `docker compose`, Node ESM deploy script, pnpm 10 + Turborepo monorepo build, Nuxt 4 / Nitro `node-server`, LibSQL/Turso (remote → stateless container).

---

## Repository Reality (read before starting)

- **Git root is `openape-monorepo/`**, not the parent `openape/` container directory. All paths below are relative to the monorepo root. This plan is being executed in worktree `openape-monorepo.worktrees/openape-monorepo-feat-issue-561` on branch `feat/issue-561-troop-docker-deploy` (issue #561).
- **Spec:** `docs/superpowers/specs/2026-06-05-troop-docker-deploy-design.md` (approved). This plan implements it; read it for the "why".
- **Docker precedents to mirror:** `apps/openape-nest/Dockerfile` (multi-stage, monorepo build, `--ignore-scripts`), `apps/openape-llm/Dockerfile` (healthcheck idiom), `compose/docker-compose.yml` (service shape, `.env` interpolation source).
- **Deployer precedent to mirror:** `scripts/deploy.mjs` (TARGETS map, `--list`/`--dry-run`/`--changed`, `ssh()` helper, capture-prev + rollback) and `scripts/deploy-troop.sh` (SSH user `openape`, host `chatty.delta-mind.at`, port 3010, health-check loop, the `@libsql` native-binding pin).

### Verified ground truth (2026-06-05)

- troop package name: **`@openape/troop`**; build = `nuxt build`; `private: true`; deps include workspace `@openape/auth`, `@openape/core`, `@openape/nuxt-auth-sp` (all in-workspace under `packages/` + `modules/`). The stale nest-Dockerfile comment claiming `@openape/nuxt-auth-sp` lives in a sibling repo is **wrong now** — it is `modules/nuxt-auth-sp`.
- Nitro preset: **default `node-server`** (no `nitro.preset` set) → output is `apps/openape-troop/.output/server/index.mjs`, self-contained. **No `pnpm deploy` flatten needed** (unlike nest). Fallback documented in Task 2 if a runtime dep is missing.
- troop listens on **3010** (`devServer.port: 3010`); Nitro honours `NITRO_PORT`/`PORT` + `HOST`/`NITRO_HOST`.
- `pnpm@10.29.3` is pinned via root `package.json`'s `packageManager` field → `corepack enable` makes in-repo `pnpm` resolve to exactly that version.
- `compose/.gitignore` already ignores `.env` and `.env.*` (negating only `.env.example`). So `.env.troop` is **already gitignored**; a tracked example needs an explicit negation (Task 3).
- `docker buildx` v0.33 present; the `orbstack` builder advertises `linux/amd64` + `linux/arm64` (QEMU) → multi-arch build + amd64 smoke are possible locally.

### Three spec-mechanic corrections this plan applies (with rationale)

1. **Deterministic health endpoint.** The spec's compose healthcheck hits `/` with `r.ok` (200–299). troop's `/` can render a login/redirect state for unauthenticated requests (the existing `deploy-troop.sh` health-check deliberately accepts `200|301|302|401|403`), so `r.ok` on `/` is fragile. Task 1 adds **`/api/health`** returning a static `200 {ok:true}` (no auth, no DB) and the healthcheck + deployer target that. Acceptance criterion 2 still asserts `/` = 200 for the real app.
2. **`env_file` is not the compose interpolation source.** The spec proposes writing `TROOP_TAG` into `.env.troop`, but `env_file` only injects vars **into the container** — `${TROOP_TAG}` interpolation in the compose file is resolved from the compose project dir's **`.env`** (or the shell), confirmed by `compose/.env.example` ("Docker Compose reads this automatically"). So: `.env.troop` = human secrets only (env_file); the deployer manages `TROOP_TAG`/`TROOP_TAG_PREV`/`REGISTRY` in the compose dir's **`.env`** (gitignored).
3. **`@libsql` native binding.** `deploy-troop.sh` manually pins `@libsql/linux-x64-gnu@0.4.7` into the rsynced `.output` because the macOS build can't ship the Linux binding. In Docker, `buildx` builds **each arch natively**, so `pnpm install` fetches the matching `@libsql/linux-<arch>-gnu` and Nitro should trace it into `.output`. Task 2 **verifies** this with an explicit in-container libsql load and documents the pin-fallback if it is missing.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/openape-troop/server/api/health.get.ts` | Deterministic, auth/DB-free 200 health endpoint |
| Create | `apps/openape-troop/tests/health.test.ts` | Unit test for the health payload helper |
| Create | `.dockerignore` (repo root) | Strip `.git`/`node_modules`/`.output`/`.nuxt`/`dist` from the build context (all root-context Docker builds benefit) |
| Create | `apps/openape-troop/Dockerfile` | Multi-stage build → slim Nitro runtime on 3010 |
| Create | `compose/chatty.yml` | `openape-troop` service: image/build, `127.0.0.1:3010`, `env_file: .env.troop`, healthcheck on `/api/health` |
| Create | `compose/.env.troop.example` | Tracked template enumerating every runtime env var |
| Modify | `compose/.gitignore` | Add `!.env.troop.example` so the template stays tracked |
| Create | `scripts/deploy-image.mjs` | Generic image deployer (buildx push → tag-pin → ssh pull+up → health → rollback) |
| Create | `scripts/deploy-image.test.ts` | Unit tests for the deployer's pure helpers |
| Modify | `package.json` (root) | Add `"deploy:image": "node scripts/deploy-image.mjs"` |
| Create | `compose/CHATTY-DOCKER.md` | Operator runbook: chatty compose dir layout + the human-gated steps |

---

## Task 1: Deterministic health endpoint + root `.dockerignore`

**Files:**
- Create: `apps/openape-troop/server/api/health.get.ts`
- Create: `apps/openape-troop/tests/health.test.ts`
- Create: `.dockerignore`

- [ ] **Step 1: Write the failing test**

Create `apps/openape-troop/tests/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { healthPayload } from '../server/api/health.get'

describe('health endpoint', () => {
  it('returns a static ok payload with no auth/DB dependency', () => {
    const payload = healthPayload()
    expect(payload.ok).toBe(true)
    expect(payload.service).toBe('openape-troop')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @openape/troop test health`
Expected: FAIL — `Failed to resolve import "../server/api/health.get"` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/openape-troop/server/api/health.get.ts`:

```ts
// Deterministic liveness probe for the container healthcheck and the
// image deployer. Intentionally touches no auth and no database so it
// returns 200 even before Turso is reachable or a session exists —
// unlike `/`, which can render a login/redirect state. See
// docs/superpowers/specs/2026-06-05-troop-docker-deploy-design.md.
export function healthPayload() {
  return { ok: true as const, service: 'openape-troop' as const }
}

export default defineEventHandler(() => healthPayload())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @openape/troop test health`
Expected: PASS (1 test).

- [ ] **Step 5: Create the root `.dockerignore`**

Create `.dockerignore` at the monorepo root:

```
.git
**/node_modules
**/.output
**/.nuxt
**/dist
**/.turbo
**/coverage
**/*.log
**/.env
**/.env.*
!**/.env.example
!**/.env.troop.example
.DS_Store
```

Rationale: the Docker build context is the monorepo root (`context: ..` in compose). Excluding these keeps the context small/fast and prevents host-built `.output`/`node_modules` (wrong arch) from leaking into the image. The `.env*` excludes guarantee no host secrets enter the build context (acceptance criterion 6).

- [ ] **Step 6: Verify typecheck + lint + troop build are green**

Run:
```bash
pnpm --filter @openape/troop typecheck
pnpm --filter @openape/troop lint
pnpm turbo run build --filter=@openape/troop
```
Expected: all exit 0; build emits `apps/openape-troop/.output/server/index.mjs`.

Confirm the route compiled into the server bundle:
```bash
test -f apps/openape-troop/.output/server/index.mjs && echo "output ok"
```
Expected: `output ok`.

- [ ] **Step 7: Commit**

```bash
git add apps/openape-troop/server/api/health.get.ts apps/openape-troop/tests/health.test.ts .dockerignore
git commit -m "feat(troop): add /api/health endpoint and root .dockerignore"
```

---

## Task 2: `apps/openape-troop/Dockerfile` (multi-stage)

**Files:**
- Create: `apps/openape-troop/Dockerfile`

Build context = monorepo root. Builder mirrors `apps/openape-nest/Dockerfile` (corepack pnpm, `--ignore-scripts`, build only the named filter). Runtime ships the self-contained Nitro `.output`.

- [ ] **Step 1: Write the Dockerfile**

Create `apps/openape-troop/Dockerfile`:

```dockerfile
# openape-troop container image — Nuxt 4 / Nitro (node-server preset).
#
# Multi-stage: stage 1 builds the monorepo with pnpm + turbo and emits
# troop's self-contained `.output`; stage 2 is a slim node runtime that
# runs `.output/server/index.mjs`. troop is stateless (LibSQL via remote
# Turso) so the runtime needs no volume — only env from `.env.troop`.
#
# Build from the monorepo root (multi-arch via buildx in the real path):
#   docker build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
#
# Run standalone:
#   docker run --rm -p 3010:3010 --env-file compose/.env.troop openape-troop:dev

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV CI=1
# corepack resolves pnpm from the root package.json `packageManager`
# field (pnpm@10.29.3) once a manifest with that field is on disk.
RUN corepack enable

WORKDIR /work

# Manifests first for a cacheable install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Only troop + the workspace packages it needs. Other apps are omitted so
# their Nuxt `postinstall` (nuxt prepare) never runs in this image. troop
# depends on @openape/auth, @openape/core, @openape/nuxt-auth-sp; copy the
# whole packages/ + modules/ trees (their deps resolve via the lockfile).
COPY apps/openape-troop ./apps/openape-troop
COPY modules ./modules
COPY packages ./packages

# --ignore-scripts: skip every package's postinstall (the Nuxt module
# stubs + nuxt prepare). `turbo run build` below builds the modules for
# real (their dist) before troop's `nuxt build` consumes them, so the
# stub step is unnecessary. Same rationale as the nest image.
RUN pnpm install --frozen-lockfile --ignore-scripts

# turbo builds the dependency closure (core → auth → nuxt-auth-sp) before
# troop's own `nuxt build`, in the right order. troop's build script is
# `nuxt build`, which runs its own prepare.
RUN pnpm turbo run build --filter=@openape/troop

# ---- Stage 2: runtime -----------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# ca-certificates: troop reaches Turso (libsql https) + the IdP over TLS.
# tini reaps zombies / forwards SIGTERM cleanly to the node server.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Nitro's node-server output is self-contained (bundled deps + traced
# native modules under .output/server/node_modules). Copying it is the
# whole runtime.
COPY --from=build /work/apps/openape-troop/.output ./.output

# Bind the loopback-published port; HOST=0.0.0.0 so the container accepts
# the host->container forward. NITRO_PORT and PORT are both honoured;
# set both to be preset-agnostic.
ENV NODE_ENV=production
ENV NITRO_PORT=3010
ENV PORT=3010
ENV HOST=0.0.0.0
ENV NITRO_HOST=0.0.0.0

EXPOSE 3010

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
```

- [ ] **Step 2: Build the image locally (this is the test)**

Run:
```bash
docker build -f apps/openape-troop/Dockerfile -t openape-troop:dev .
```
Expected: build completes, final image tagged `openape-troop:dev`.

**Branch — if `pnpm install --frozen-lockfile` fails** complaining the lockfile is out of date vs the workspace (because only a subset of apps is on disk): change the install line to copy the full source instead — replace the three `COPY apps/openape-troop … packages …` lines with `COPY . .` (the root `.dockerignore` strips heavy dirs) and keep `--ignore-scripts`. Rebuild. Document which path was used in the commit message.

**Branch — if the runtime container later errors with a missing `@libsql` binding** (Step 4 below surfaces it): the Nitro trace dropped the native module. Mirror `deploy-troop.sh`'s pin by adding, before the `CMD` in the runtime stage:
```dockerfile
# Restore the arch-matched libsql native binding if Nitro failed to trace
# it. dpkg arch maps to libsql's package suffix (amd64→x64, arm64→arm64).
RUN ARCH=$(dpkg --print-architecture) \
    && case "$ARCH" in amd64) LIB=linux-x64-gnu ;; arm64) LIB=linux-arm64-gnu ;; *) LIB="" ;; esac \
    && if [ -n "$LIB" ] && [ ! -d ".output/server/node_modules/@libsql/$LIB" ]; then \
         cd /tmp && npm pack "@libsql/$LIB@0.4.7" >/dev/null 2>&1 \
         && tar -xzf "libsql-$LIB-0.4.7.tgz" \
         && mkdir -p "/app/.output/server/node_modules/@libsql/$LIB" \
         && cp package/* "/app/.output/server/node_modules/@libsql/$LIB/" ; \
       fi
```

- [ ] **Step 3: Run the container with a local-file Turso URL**

Create a throwaway env file (NOT committed):
```bash
cat > /tmp/troop.env <<'EOF'
NUXT_TURSO_URL=file:/tmp/troop-test.db
NUXT_TURSO_AUTH_TOKEN=
NUXT_OPENAPE_SP_SESSION_SECRET=test-secret-at-least-32-chars-long-xxxxx
NUXT_PUBLIC_IDP_URL=https://id.openape.ai
EOF
docker run -d --name troop-smoke -p 3010:3010 --env-file /tmp/troop.env openape-troop:dev
sleep 5
```

- [ ] **Step 4: Verify health + libsql binding**

Run:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/api/health   # expect 200
curl -s http://127.0.0.1:3010/api/health                                    # expect {"ok":true,"service":"openape-troop"}
docker exec troop-smoke sh -c 'ls .output/server/node_modules/@libsql/ 2>/dev/null || echo NO_LIBSQL_DIR'
docker logs troop-smoke 2>&1 | tail -20
```
Expected: `/api/health` returns `200` and the JSON payload; the `@libsql` listing shows a `linux-arm64-gnu` dir (arm64 host) **or** logs show no libsql load error. If a libsql error appears, apply the Step 2 binding-pin branch and rebuild.

- [ ] **Step 5: Tear down the smoke container**

Run:
```bash
docker rm -f troop-smoke
```

- [ ] **Step 6: Commit**

```bash
git add apps/openape-troop/Dockerfile
git commit -m "feat(troop): multi-stage Dockerfile for Nitro node-server image"
```

---

## Task 3: `compose/chatty.yml` + env template + gitignore negation

**Files:**
- Create: `compose/chatty.yml`
- Create: `compose/.env.troop.example`
- Modify: `compose/.gitignore`

- [ ] **Step 1: Write `compose/chatty.yml`**

Create `compose/chatty.yml`:

```yaml
# chatty web-app pod — tested-image deploys.
#
# One service per chatty-hosted web app, each published on its loopback
# port so the existing nginx vhosts (TLS + *.openape.ai routing) stay
# UNCHANGED. Pilot: openape-troop only; org/chat/free-idp slot in later
# as further services (follow-up spec).
#
# Image reference is registry-agnostic: REGISTRY defaults to GHCR but can
# be repointed at a self-hosted registry without editing this file. The
# tag (TROOP_TAG) is pinned by scripts/deploy-image.mjs via the compose
# project dir's `.env` (NOT .env.troop — env_file is container-only and is
# not the interpolation source). `latest` is only the local-dev default.
#
# Local dev (build + run on the Mac):
#   cp compose/.env.troop.example compose/.env.troop   # fill values
#   docker compose -f compose/chatty.yml up --build openape-troop
#
# chatty (pull a pushed image, no build):
#   docker compose -f compose/chatty.yml pull openape-troop
#   docker compose -f compose/chatty.yml up -d --no-build openape-troop

services:
  openape-troop:
    image: ${REGISTRY:-ghcr.io/openape-ai}/openape-troop:${TROOP_TAG:-latest}
    # build: lets `up --build` work locally; chatty uses `--no-build` so
    # it never needs the monorepo context, just the pulled image.
    build:
      context: ..
      dockerfile: apps/openape-troop/Dockerfile
    container_name: openape-troop
    restart: unless-stopped
    ports:
      - "127.0.0.1:3010:3010"
    env_file:
      - .env.troop
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3010/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

- [ ] **Step 2: Write the env template**

Create `compose/.env.troop.example`:

```bash
# Copy to compose/.env.troop and fill in real values.
# This is the CONTAINER env (compose `env_file`) — troop's runtime config.
# It is gitignored; never commit the filled version. Never bake into the image.
#
# Image pinning vars (REGISTRY, TROOP_TAG) do NOT go here — they live in
# the compose project dir's `.env` and are managed by scripts/deploy-image.mjs.

# --- Database (remote Turso → stateless container) ---
NUXT_TURSO_URL=libsql://<your-troop-db>.turso.io
NUXT_TURSO_AUTH_TOKEN=<turso-auth-token>

# --- SP / OIDC session ---
# Must be >= 32 chars and unique per environment. Defaulting it is unsafe.
NUXT_OPENAPE_SP_SESSION_SECRET=<random-32+-char-secret>
NUXT_OPENAPE_CLIENT_ID=troop.openape.ai
NUXT_OPENAPE_SP_NAME=OpenApe Troop
# SP→IdP base (leave to the fallback unless self-hosting the IdP elsewhere).
NUXT_OPENAPE_URL=
NUXT_OPENAPE_SP_FALLBACK_IDP_URL=https://id.openape.ai

# --- Public (client-exposed) ---
NUXT_PUBLIC_IDP_URL=https://id.openape.ai

# --- Optional: Exoscale cloud-pod hatching (only if used) ---
# EXOSCALE_API_BASE=
# EXOSCALE_API_KEY=
# EXOSCALE_API_SECRET=
```

> Source of the var list: `apps/openape-troop/nuxt.config.ts` (`runtimeConfig`, `openapeSp`) + every `process.env.*` referenced under `apps/openape-troop/` (verified 2026-06-05). `OPENAPE_E2E` is test-only and intentionally omitted.

- [ ] **Step 3: Keep the template tracked**

Edit `compose/.gitignore` — add the negation so the example survives the `.env.*` ignore. The file currently reads:
```
# Operator-specific runtime files — kept untracked.
.env
.env.*
!.env.example
litellm.yaml
```
Change it to:
```
# Operator-specific runtime files — kept untracked.
.env
.env.*
!.env.example
!.env.troop.example
litellm.yaml
```

- [ ] **Step 4: Verify the template is tracked and a real env is ignored**

Run:
```bash
git check-ignore -v compose/.env.troop.example || echo "TRACKED (good)"
git check-ignore compose/.env.troop && echo "IGNORED (good)"
```
Expected: first prints `TRACKED (good)`; second prints `compose/.env.troop` then `IGNORED (good)` (the path is matched by `.env.*`). Create a dummy `compose/.env.troop` first if needed for the second check, then delete it.

- [ ] **Step 5: Local compose smoke (acceptance criterion 2)**

Run:
```bash
cp compose/.env.troop.example compose/.env.troop
# For a no-Turso local run, point at a file DB and set a test secret:
printf 'NUXT_TURSO_URL=file:/tmp/troop-compose.db\nNUXT_TURSO_AUTH_TOKEN=\nNUXT_OPENAPE_SP_SESSION_SECRET=test-secret-at-least-32-chars-long-xxxxx\nNUXT_PUBLIC_IDP_URL=https://id.openape.ai\n' > compose/.env.troop
docker compose -f compose/chatty.yml up -d --build openape-troop
sleep 8
docker compose -f compose/chatty.yml ps
curl -s -o /dev/null -w 'health:%{http_code}\n' http://127.0.0.1:3010/api/health   # expect 200
curl -s -o /dev/null -w 'root:%{http_code}\n'   http://127.0.0.1:3010/             # expect 200
```
Expected: `docker compose ps` shows the container `healthy`; `health:200`; `root:200`.

- [ ] **Step 6: Capture proof (screenshot of the agents list / root)**

Render `http://127.0.0.1:3010/` headless and view it:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1280,900 --screenshot=/tmp/troop-docker.png "http://127.0.0.1:3010/"
```
Read `/tmp/troop-docker.png` with the Read tool to confirm the troop UI (agents list or login) renders. Keep the PNG for the PR handoff.

- [ ] **Step 7: Tear down + clean the local secret**

Run:
```bash
docker compose -f compose/chatty.yml down
rm -f compose/.env.troop
```

- [ ] **Step 8: Commit**

```bash
git add compose/chatty.yml compose/.env.troop.example compose/.gitignore
git commit -m "feat(compose): chatty.yml troop service + env template"
```

---

## Task 4: Multi-arch build + amd64 QEMU smoke (verification, no push)

This proves arch parity locally. **No GHCR push** — that needs the human-gated `docker login` (Prerequisites). Produces evidence for the PR.

**Files:** none created.

- [ ] **Step 1: Multi-arch build (both platforms compile)**

Run:
```bash
docker buildx build --platform linux/arm64,linux/amd64 \
  -f apps/openape-troop/Dockerfile -t openape-troop:multiarch . \
  --metadata-file /tmp/troop-buildx-meta.json
cat /tmp/troop-buildx-meta.json
```
Expected: both platforms build without error. (Without `--push`/`--load`, buildx discards the result but proves both arches compile — that is the parity check.)

- [ ] **Step 2: Build the amd64 slice loadable, run under QEMU**

Run:
```bash
docker buildx build --platform linux/amd64 --load \
  -f apps/openape-troop/Dockerfile -t openape-troop:amd64 .
printf 'NUXT_TURSO_URL=file:/tmp/troop-amd64.db\nNUXT_TURSO_AUTH_TOKEN=\nNUXT_OPENAPE_SP_SESSION_SECRET=test-secret-at-least-32-chars-long-xxxxx\nNUXT_PUBLIC_IDP_URL=https://id.openape.ai\n' > /tmp/troop-amd64.env
docker run -d --name troop-amd64 --platform linux/amd64 -p 3010:3010 --env-file /tmp/troop-amd64.env openape-troop:amd64
sleep 10
curl -s -o /dev/null -w 'amd64-health:%{http_code}\n' http://127.0.0.1:3010/api/health   # expect 200
docker exec troop-amd64 sh -c 'ls .output/server/node_modules/@libsql/ 2>/dev/null || echo NO_LIBSQL_DIR'
docker logs troop-amd64 2>&1 | tail -20
```
Expected: `amd64-health:200`; the `@libsql` listing shows `linux-x64-gnu` (or no load error). If a libsql error appears on amd64, apply Task 2 Step 2's binding-pin branch.

- [ ] **Step 3: Tear down**

Run:
```bash
docker rm -f troop-amd64
rm -f /tmp/troop-amd64.env
```

No commit (verification task). Record the `amd64-health:200` line + both-platform build success in the PR body.

---

## Task 5: `scripts/deploy-image.mjs` deployer + unit tests

**Files:**
- Create: `scripts/deploy-image.mjs`
- Create: `scripts/deploy-image.test.ts`
- Modify: `package.json` (root)

The deployer's SSH/build/push side-effects are human-gated (need GHCR login + chatty access), so TDD targets the **pure helpers**; the orchestration is verified via `--list` and `--dry-run` (touch nothing).

- [ ] **Step 1: Write the failing unit test**

Create `scripts/deploy-image.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { digestFromMetadata, imageRef, parseArgs, TARGETS } from './deploy-image.mjs'

describe('deploy-image helpers', () => {
  it('builds a registry/app:tag reference', () => {
    expect(imageRef('ghcr.io/openape-ai', 'openape-troop', 'abc123')).toBe('ghcr.io/openape-ai/openape-troop:abc123')
  })

  it('parses flags and positional targets', () => {
    const a = parseArgs(['troop', '--dry-run', '--platform=linux/amd64'])
    expect(a.dryRun).toBe(true)
    expect(a.targets).toEqual(['troop'])
    expect(a.platforms).toBe('linux/amd64')
    expect(a.list).toBe(false)
    expect(a.rollback).toBe(false)
  })

  it('defaults to multi-arch platforms', () => {
    expect(parseArgs(['troop']).platforms).toBe('linux/arm64,linux/amd64')
  })

  it('extracts the image digest from buildx metadata', () => {
    const meta = JSON.stringify({ 'containerimage.digest': 'sha256:deadbeef' })
    expect(digestFromMetadata(meta)).toBe('sha256:deadbeef')
  })

  it('returns null when metadata has no digest', () => {
    expect(digestFromMetadata('{}')).toBeNull()
  })

  it('knows the troop target with its loopback port and health path', () => {
    expect(TARGETS.troop.port).toBe(3010)
    expect(TARGETS.troop.healthPath).toBe('/api/health')
    expect(TARGETS.troop.composeService).toBe('openape-troop')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run scripts/deploy-image.test.ts`
Expected: FAIL — cannot resolve `./deploy-image.mjs`.

- [ ] **Step 3: Write the deployer**

Create `scripts/deploy-image.mjs`:

```js
#!/usr/bin/env node

/**
 * Tested-image deployer — the Docker counterpart to scripts/deploy.mjs
 * (which is rsync+systemd). Builds a multi-arch image with buildx, pushes
 * it to the registry, pins the pushed tag in the chatty compose project's
 * `.env`, then `pull`s + `up -d`s the service over SSH and health-checks
 * it. On health failure it restores the previous pinned tag and re-ups
 * (rollback).
 *
 * Image delivery is registry-agnostic: REGISTRY defaults to GHCR.
 *
 * Usage:
 *   pnpm deploy:image <target...>        # build+push+deploy (e.g. troop)
 *   pnpm deploy:image troop --dry-run    # print the plan; touch nothing
 *   pnpm deploy:image troop --build-only # build+push, skip the chatty deploy
 *   pnpm deploy:image troop --rollback   # re-up the previous pinned tag
 *   pnpm deploy:image --list             # list known targets
 *
 * Env:
 *   REGISTRY            default ghcr.io/openape-ai
 *   CHATTY_USER         default openape
 *   CHATTY_HOST         default chatty.delta-mind.at
 *   CHATTY_COMPOSE_DIR  default /home/openape/projects/openape-compose
 *
 * Prerequisites (human-gated): `docker login ghcr.io` on the Mac (push)
 * and on chatty (pull); the compose dir on chatty containing chatty.yml +
 * a filled .env.troop. See compose/CHATTY-DOCKER.md.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPTS_DIR, '..')
const SSH_USER = process.env.CHATTY_USER || 'openape'
const SSH_HOST = process.env.CHATTY_HOST || 'chatty.delta-mind.at'
const REGISTRY = process.env.REGISTRY || 'ghcr.io/openape-ai'
const COMPOSE_DIR = process.env.CHATTY_COMPOSE_DIR || '/home/openape/projects/openape-compose'

// One entry per dockerized chatty web app. composeService = the service
// name in compose/chatty.yml; tagVar/prevVar = keys this deployer manages
// in the compose dir's `.env`; healthPath = the 200-always endpoint.
export const TARGETS = {
  troop: {
    app: 'openape-troop',
    dockerfile: 'apps/openape-troop/Dockerfile',
    composeService: 'openape-troop',
    port: 3010,
    tagVar: 'TROOP_TAG',
    prevVar: 'TROOP_TAG_PREV',
    healthPath: '/api/health',
  },
}

export function imageRef(registry, app, tag) {
  return `${registry}/${app}:${tag}`
}

export function parseArgs(argv) {
  const platformArg = argv.find(a => a.startsWith('--platform='))
  return {
    dryRun: argv.includes('--dry-run'),
    list: argv.includes('--list'),
    rollback: argv.includes('--rollback'),
    buildOnly: argv.includes('--build-only'),
    platforms: platformArg ? platformArg.split('=')[1] : 'linux/arm64,linux/amd64',
    targets: argv.filter(a => !a.startsWith('--')),
  }
}

export function digestFromMetadata(metadataJson) {
  try {
    const m = JSON.parse(metadataJson)
    return m['containerimage.digest'] || null
  } catch {
    return null
  }
}

function gitSha() {
  return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function ssh(remoteCmd) {
  return execFileSync('ssh', ['-l', SSH_USER, SSH_HOST, remoteCmd], { encoding: 'utf-8' }).trim()
}

// Read/update a single KEY=value line in the chatty compose dir's `.env`
// (the interpolation source). Idempotent: replaces or appends the key.
function remoteEnvGet(key) {
  return ssh(`grep -E '^${key}=' ${COMPOSE_DIR}/.env 2>/dev/null | tail -1 | cut -d= -f2- || true`)
}
function remoteEnvSet(key, value) {
  // sed-in-place if present, else append. touch ensures the file exists.
  ssh(`touch ${COMPOSE_DIR}/.env && (grep -qE '^${key}=' ${COMPOSE_DIR}/.env && sed -i 's|^${key}=.*|${key}=${value}|' ${COMPOSE_DIR}/.env || echo '${key}=${value}' >> ${COMPOSE_DIR}/.env)`)
}

function buildAndPush(t, tag, platforms) {
  const ref = imageRef(REGISTRY, t.app, tag)
  console.log(`  buildx → ${ref}  [${platforms}]`)
  const res = spawnSync('docker', [
    'buildx', 'build',
    '--platform', platforms,
    '-f', t.dockerfile,
    '-t', ref,
    '--push',
    '--metadata-file', '/tmp/deploy-image-meta.json',
    '.',
  ], { cwd: ROOT, stdio: 'inherit', env: process.env })
  if (res.status !== 0) throw new Error(`buildx build/push failed (exit ${res.status})`)
  let digest = null
  try { digest = digestFromMetadata(execFileSync('cat', ['/tmp/deploy-image-meta.json'], { encoding: 'utf-8' })) } catch {}
  console.log(`  pushed digest: ${digest || '<unknown>'}`)
  return { ref, digest }
}

function composeUp(t) {
  ssh(`cd ${COMPOSE_DIR} && docker compose -f chatty.yml pull ${t.composeService} && docker compose -f chatty.yml up -d --no-build ${t.composeService}`)
}

function healthCheck(t) {
  // Loop up to 20s; treat HTTP 200 on the health path as up.
  const cmd = `for i in $(seq 1 20); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${t.port}${t.healthPath} || echo 000); if [ "$code" = "200" ]; then echo "up ($code) after ${'${i}'}s"; exit 0; fi; sleep 1; done; echo "health failed"; exit 1`
  return spawnSync('ssh', ['-l', SSH_USER, SSH_HOST, cmd], { stdio: 'inherit' }).status === 0
}

function deployTarget(name, opts) {
  const t = TARGETS[name]
  const tag = gitSha()

  if (opts.dryRun) {
    console.log(`\n▶ ${name} (dry run)`)
    console.log(`  would buildx --push ${imageRef(REGISTRY, t.app, tag)} [${opts.platforms}]`)
    console.log(`  would set ${t.prevVar}=<current ${t.tagVar}>, ${t.tagVar}=${tag} in ${SSH_USER}@${SSH_HOST}:${COMPOSE_DIR}/.env`)
    console.log(`  would: cd ${COMPOSE_DIR} && docker compose -f chatty.yml pull ${t.composeService} && up -d --no-build ${t.composeService}`)
    console.log(`  would health-check http://127.0.0.1:${t.port}${t.healthPath}; rollback to ${t.prevVar} on failure`)
    return true
  }

  if (opts.rollback) {
    const prev = remoteEnvGet(t.prevVar)
    if (!prev) { console.error(`  no ${t.prevVar} recorded — cannot roll back`); return false }
    console.log(`  ↩ rolling back ${name} to ${prev}`)
    remoteEnvSet(t.tagVar, prev)
    composeUp(t)
    return healthCheck(t)
  }

  console.log(`\n▶ ${name} → tag ${tag}`)
  buildAndPush(t, tag, opts.platforms)
  if (opts.buildOnly) { console.log('  --build-only: skipping chatty deploy'); return true }

  // Pin: remember the live tag as PREV, then point at the new tag.
  const live = remoteEnvGet(t.tagVar)
  if (live) remoteEnvSet(t.prevVar, live)
  remoteEnvSet(t.tagVar, tag)

  composeUp(t)
  if (healthCheck(t)) { console.log(`✓ ${name} deployed (${tag})`); return true }

  // Rollback on health failure.
  console.error(`✗ ${name} unhealthy — rolling back`)
  if (live) { remoteEnvSet(t.tagVar, live); composeUp(t) }
  return false
}

const opts = parseArgs(process.argv.slice(2))

if (opts.list) {
  console.log('Image deploy targets:')
  for (const n of Object.keys(TARGETS)) console.log(`  ${n}`)
  process.exit(0)
}

const unknown = opts.targets.filter(n => !TARGETS[n])
if (unknown.length) {
  console.error(`Unknown target(s): ${unknown.join(', ')}`)
  console.error(`Known: ${Object.keys(TARGETS).join(', ')}`)
  process.exit(2)
}
if (opts.targets.length === 0) {
  console.log('Nothing to deploy. Try --list.')
  process.exit(0)
}

let ok = true
for (const name of opts.targets) ok = deployTarget(name, opts) && ok
process.exit(ok ? 0 : 1)
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm vitest run scripts/deploy-image.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the root npm script**

Edit root `package.json` — add after the `"deploy"` line:
```json
    "deploy": "node scripts/deploy.mjs",
    "deploy:image": "node scripts/deploy-image.mjs",
```

- [ ] **Step 6: Verify the deployer is inert in dry/list mode**

Run:
```bash
node scripts/deploy-image.mjs --list
node scripts/deploy-image.mjs troop --dry-run
```
Expected: `--list` prints `troop`; `--dry-run` prints the full plan (buildx ref, env-pin, compose pull/up, health-check) and **performs no SSH, build, or push** (no network calls). Confirm nothing was pushed and no SSH happened (no output from a real connection).

- [ ] **Step 7: Lint + typecheck the new script**

Run:
```bash
pnpm lint
pnpm typecheck
```
Expected: both green (the `.mjs` is plain Node ESM; the `.test.ts` typechecks under vitest config).

- [ ] **Step 8: Commit**

```bash
git add scripts/deploy-image.mjs scripts/deploy-image.test.ts package.json
git commit -m "feat(deploy): generic tested-image deployer deploy-image.mjs"
```

---

## Task 6: chatty operator runbook + handoff doc

**Files:**
- Create: `compose/CHATTY-DOCKER.md`

- [ ] **Step 1: Write the runbook**

Create `compose/CHATTY-DOCKER.md`:

````markdown
# chatty Docker deploys (pilot: troop)

The tested-image pipeline ships a locally-verified multi-arch image to GHCR,
then runs it on chatty via `docker compose`. nginx/TLS is unchanged — the
container publishes `127.0.0.1:3010` exactly where the troop vhost already
points. The systemd `openape-troop.service` stays **dormant** (stopped +
disabled) as an instant fallback during the pilot.

## chatty compose dir layout

`$CHATTY_COMPOSE_DIR` (default `/home/openape/projects/openape-compose/`):

```
chatty.yml        # rsynced from the repo (compose/chatty.yml)
.env              # machine-managed by deploy-image.mjs: REGISTRY, TROOP_TAG, TROOP_TAG_PREV
.env.troop        # HUMAN-managed secrets (Turso, session secret, …). gitignored. chmod 600.
```

`.env` is the compose interpolation source (`${TROOP_TAG}`); `.env.troop` is
the container `env_file`. They are deliberately separate.

## One-time setup (human-gated — needs credentials)

1. **GHCR PATs + login**
   - Mac (push): PAT with `write:packages` → `docker login ghcr.io -u <user>`.
   - chatty (pull): PAT with `read:packages` → `docker login ghcr.io -u <user>`.
   - Ensure the `openape-troop` org package is private and chatty's PAT can read it.
2. **Compose dir on chatty**
   ```bash
   ssh openape@chatty.delta-mind.at 'mkdir -p /home/openape/projects/openape-compose'
   rsync -az compose/chatty.yml openape@chatty.delta-mind.at:/home/openape/projects/openape-compose/
   ```
3. **`.env.troop` on chatty** — copy the real runtime env (Turso URL+token,
   session secret, IdP URL, …) from the current systemd unit / app config
   into `/home/openape/projects/openape-compose/.env.troop`; `chmod 600`.
   Template: `compose/.env.troop.example`.

## Deploy

From the Mac (monorepo root), after `docker login ghcr.io`:
```bash
pnpm deploy:image troop                 # build multi-arch, push, deploy, health-check
pnpm deploy:image troop --dry-run       # plan only
pnpm deploy:image troop --build-only    # push image, skip chatty deploy
pnpm deploy:image troop --rollback      # re-up the previous pinned tag
```

## Cutover (human-gated — prod action, needs your go)

```bash
ssh openape@chatty.delta-mind.at 'sudo systemctl stop openape-troop.service && sudo systemctl disable openape-troop.service'
pnpm deploy:image troop
curl -s -o /dev/null -w '%{http_code}\n' https://troop.openape.ai/    # expect 200
ssh openape@chatty.delta-mind.at 'docker ps --filter name=openape-troop'   # healthy
```
Leave the unit installed-but-dormant. To fall back instantly:
```bash
ssh openape@chatty.delta-mind.at 'cd /home/openape/projects/openape-compose && docker compose -f chatty.yml down openape-troop && sudo systemctl enable --now openape-troop.service'
```
````

- [ ] **Step 2: Commit**

```bash
git add compose/CHATTY-DOCKER.md
git commit -m "docs(compose): chatty docker deploy runbook + handoff"
```

---

## Human-Gated Steps (handoff — do NOT do these autonomously)

These need Patrick's credentials / prod go. The PR stops here.

1. **GHCR auth:** create PAT(s) (`write:packages` Mac, `read:packages` chatty); `docker login ghcr.io` on both hosts; confirm the `openape-troop` package is private + readable from chatty.
2. **`.env.troop` on chatty:** populate with troop's real runtime values (from the live systemd unit / app config), `chmod 600`.
3. **Push + first real deploy:** `pnpm deploy:image troop` (needs #1).
4. **Prod cutover:** stop+disable `openape-troop.service`, `pnpm deploy:image troop`, verify `https://troop.openape.ai/` = 200 + agents list + `docker ps` healthy.
5. **Rollback drill** (acceptance criterion 5): `pnpm deploy:image troop --rollback` → site stays 200 → redeploy current.

The agent completes everything up to (not including) #1: Dockerfile, compose, deployer, runbook, local arm64 + amd64-QEMU verification, unit tests, dry-run. Then opens a PR (not merged) listing these steps.

---

## Self-Review (against the spec)

**Spec coverage:**
- Component 1 (troop Dockerfile, multi-stage, Nitro self-contained + libsql fallback) → Task 2. ✓
- Component 2 (`compose/chatty.yml` service, loopback 3010, env_file, healthcheck) → Task 3. ✓
- Component 3 (`scripts/deploy-image.mjs`: buildx multi-arch push, digest, ssh pull+up, health, rollback, REGISTRY var, dry-run/list) → Task 5. ✓
- Component 4 (GHCR auth) → human-gated handoff + runbook (Task 6). ✓
- Component 5 (cutover, systemd dormant) → runbook (Task 6) + handoff. ✓
- Locked decisions 1–5 (GHCR/registry-agnostic, multi-arch buildx, compose on chatty/nginx untouched, gitignored env, systemd dormant) → Tasks 3/5/6. ✓
- Acceptance criteria: 1 (multi-arch build) → Task 4; 2 (local compose `:3010`=200 + agents list) → Task 3 Steps 5–6; 3 (amd64 QEMU smoke) → Task 4 Step 2; 4 (prod cutover) → human-gated; 5 (rollback drill) → human-gated + deployer `--rollback`; 6 (no secret in image) → `.dockerignore` env excludes + env_file only (Tasks 1/3). ✓
- Reuse factoring (generic Dockerfile/compose/deployer, port+app the only vars) → TARGETS map + parametrized service/Dockerfile. ✓

**Deviations from the spec literal (intentional, see "Three corrections"):** health endpoint `/api/health` instead of `r.ok` on `/`; tag pin lives in compose-dir `.env` not `.env.troop`; libsql binding verified with documented fallback. All preserve the spec's intent and acceptance criteria.

**Placeholder scan:** no TBD/TODO; every file has complete content; every command has expected output. ✓

**Type/name consistency:** `healthPayload()` (Task 1) used by test + route; `imageRef`/`parseArgs`/`digestFromMetadata`/`TARGETS` (Task 5) match between test and impl; `composeService`/`port`/`healthPath`/`tagVar`/`prevVar` keys consistent across deployer + test + runbook. ✓
