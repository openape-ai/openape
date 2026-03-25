# OpenApe Monorepo

## Project Overview

OpenApe implements the **DDISA protocol** (DNS-Discoverable Identity & Service Authorization) — decentralized identity and authorization for the open web. It uses WebAuthn passkeys, DNS TXT record discovery, and grant-based authorization.

- **License:** MIT
- **Author:** Patrick Hofmann (Delta Mind GmbH)
- **Node.js:** >=22
- **Package Manager:** pnpm (workspace monorepo)
- **Build System:** Turborepo
- **Versioning:** Changesets

## Monorepo Structure

```
packages/         # Publishable libraries
  core/           # @openape/core — shared types, DNS, JWT, PKCE
  auth/           # @openape/auth — IdP + SP OIDC protocol
  grants/         # @openape/grants — grant issuance, revocation
  proxy/          # @openape/proxy — agent HTTP gateway
  s3-driver/      # @openape/unstorage-s3-driver — S3 storage driver
  browser/        # @openape/browser — Playwright wrapper
  grapes/         # @openape/grapes — grant management CLI

modules/          # Publishable Nuxt modules
  nuxt-auth-idp/  # @openape/nuxt-auth-idp — IdP Nuxt module
  nuxt-auth-sp/   # @openape/nuxt-auth-sp — SP Nuxt module

apps/             # Deployable applications (private, not published)
  service/        # @openape/cloud — Multi-tenant SaaS → Vercel
  openape-free-idp/  # Free IdP → Vercel
  openape-agent-mail/  # Mail agent → Vercel
  openape-agent-proxy/ # Proxy agent → Vercel
  docs/           # Documentation site

examples/         # Example apps + E2E tests
  idp/            # IdP example app
  sp/             # SP example app
  e2e/            # E2E integration tests
```

## Dependency Graph (Publish Order)

```
core (no deps)
  └─► auth (depends on core)
  └─► grants (depends on core)
  └─► proxy (depends on core, grants)
        └─► nuxt-auth-idp (depends on auth, core, grants)
        └─► nuxt-auth-sp (depends on auth, core)
```

All `@openape/*` dependencies use `workspace:*` protocol.

## Root Scripts (via Turborepo)

```bash
pnpm build         # Build all packages (respects dependency graph)
pnpm lint          # ESLint all projects
pnpm typecheck     # TypeScript check all projects
pnpm test          # Run all tests

# Filter to specific package
pnpm turbo run build --filter=@openape/core
pnpm turbo run test --filter=openape-agent-mail
```

## Publish Flow

Uses Changesets with a single root `.changeset/config.json`. GitHub Actions handles publishing automatically.

1. `pnpm changeset` — create a changeset describing changes
2. Push to main → Changesets bot creates a "Release" PR
3. Merge the Release PR → packages are published to npm with `--provenance`

Manual (if needed):
```bash
pnpm changeset
pnpm version-packages
pnpm release
```

## Deploy Flow

GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys on push to main with change detection per app. Manual deploy via workflow_dispatch.

Required secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_SERVICE_PROJECT_ID`, `VERCEL_FREEIDP_PROJECT_ID`, `VERCEL_AGENTMAIL_PROJECT_ID`, `VERCEL_AGENTPROXY_PROJECT_ID`.

## Workflow: Definition of Done

Jede Implementierung gilt erst als abgeschlossen, wenn sowohl Lint als auch Typecheck erfolgreich durchlaufen sind. Vor einem Commit oder Deploy **müssen** diese beiden Checks bestanden sein:

1. `pnpm lint` — alle Projekte clean
2. `pnpm typecheck` — keine Fehler

**Bei Änderungen an Nuxt-Modulen**: auch die Playground-Applikation typechecken:
```bash
pnpm turbo run typecheck --filter=@openape/nuxt-auth-idp
```

**Bei Änderungen an Apps**: `pnpm turbo run build --filter=<app>` ausführen und lokal testen.

Ohne bestandene Checks: kein Commit, kein Deploy.

## Workflow: Issue-First Development

Siehe `CONTRIBUTING.md` für den vollständigen Workflow.

**Kurzfassung für Agents:**

1. **Nie Source-Code auf `main` editieren** — `/issue <nr>` zum Starten verwenden
2. **Branch-Naming:** `<type>/issue-<nr>-<kurzbeschreibung>`
3. **PRs required** — CI muss grün sein vor Merge
4. **Ausnahmen für direct-to-main:** `.claude/`, `.github/`, `.githooks/`, `scripts/`, Config-Dateien

**Enforcement:** Claude-Hook blockiert Edit/Write auf `main` für Source-Dateien. Pre-Commit-Hook und GitHub Ruleset als zusätzliche Barrieren.

## Important Notes

- **`desktop/` and `sudo/`** are separate repos (`openape-ai/desktop`, `openape-ai/escapes`) — not part of this monorepo
- **ESLint override:** `eslint` is pinned to `^9.35.0` via pnpm overrides to avoid eslint 10 incompatibility with vue-eslint-parser
- **Nuxt module stubs:** modules run `nuxt-module-build build --stub` during `prepare` so apps can load them during install

## Code Style

- **ESLint:** `@antfu/eslint-config` — no semicolons, single quotes (root config)
- **Vue/Nuxt:** Composition API, `<script setup>`
- **CSS:** Tailwind CSS 4.0+, @nuxt/ui 4.4+
- **Testing:** Vitest
- **ORM:** Drizzle (in apps using LibSQL/SQLite)

## Tech Stack

- **Frontend:** Nuxt 4, Vue 3, Tailwind CSS, @nuxt/ui
- **Backend:** h3 (HTTP framework), Node.js >=22
- **Auth:** WebAuthn (@simplewebauthn), JWT (jose), ed25519
- **Database:** Drizzle ORM + LibSQL/SQLite
- **Storage:** Unstorage with S3-compatible driver
- **Email:** Resend
- **Payments:** Stripe (in service/)

## DDISA Protocol Compliance

OpenApe implementiert das DDISA-Protokoll. Die formale Spezifikation liegt im Repo `openape-ai/protocol`.

**Pflicht bei jeder Änderung an protokollrelevanten Dateien:**

1. Prüfe ob die Änderung mit der DDISA-Spec kompatibel ist
2. Protokollrelevante Bereiche: DNS Discovery, Auth Flow, JWT Claims, Grant API, Delegation API, Error Format, Well-Known Endpoints
3. Betroffene Packages: `packages/core`, `packages/auth`, `packages/grants`, `modules/nuxt-auth-idp`, `modules/nuxt-auth-sp`, `packages/grapes`, `apps/docs`
4. Bei Abweichung von der Spec: **User WARNEN und FRAGEN** ob die Abweichung beabsichtigt ist
5. Spec-Dokumente: `core.md`, `grants.md`, `delegation.md` im Repo `openape-ai/protocol`

Keine stille Abweichung — jede Spec-Inkompatibilität muss explizit bestätigt werden.
