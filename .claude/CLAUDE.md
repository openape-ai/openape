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
  apes/           # @openape/apes — CLI toolkit
  cli-auth/       # @openape/cli-auth — shared CLI auth lib
  server/         # @openape/server — shared server utilities
  prompt-injection-detector/  # @openape/prompt-injection-detector
  idp-test-suite/ # @openape/idp-test-suite — integration test helpers
  vue-components/ # @openape/vue-components — shared Vue components
  ape-troop/      # @openape/ape-troop — owner CLI for troop.openape.ai (nests + agents)

modules/          # Publishable Nuxt modules
  nuxt-auth-idp/  # @openape/nuxt-auth-idp — IdP Nuxt module
  nuxt-auth-sp/   # @openape/nuxt-auth-sp — SP Nuxt module

apps/             # Deployable applications (private, not published)
  openape-free-idp/   # Free DDISA IdP → self-hosted (chatty)
  openape-troop/      # Troop control plane → self-hosted (chatty)
  openape-chat/       # Chat app → self-hosted (chatty)
  openape-org/        # Org management → self-hosted (chatty)
  openape-ape-agent/  # @openape/ape-agent — per-agent runtime process
  openape-chat-cli/   # @openape/ape-chat — CLI for chat.openape.ai
  openape-nest/       # @openape/nest — local control-plane daemon
  openape-llm/        # LLM proxy container (Dockerfile only)
  docs/               # Documentation site → self-hosted (chatty)

examples/         # Example apps + E2E tests
  idp/            # IdP example app
  sp/             # SP example app
  e2e/            # E2E integration tests
  agent-recipes/  # Agent recipe examples
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

**Prod = tested images** (seit 2026-06-10): die vier Web-Apps laufen als Container aus `registry.openape.ai`, orchestriert von `scripts/deploy-image.mjs` + `compose/chatty.yml` (auf chatty unter `/home/openape/prod/`).

```bash
pnpm run deploy:image <target...>   # free-idp | troop | chat | org
pnpm run deploy:image --all
```

Ablauf pro Target: turbo build (.output, Mac, warme Caches) → COPY-only amd64-Image (`compose/preview-package.Dockerfile`, identisches Artefakt-Format wie die PR-Previews, Tag `prod-<sha>`) → lokaler Smoke-Test (`/api/health`) → push → chatty pullt + `compose up` → externes Health-Gate → bei Fehler automatischer Rollback auf `<APP>_TAG_PREV`. Kein Build auf chatty. Die Container mounten das bestehende `/home/openape/projects/<app>/shared` (gleicher Pfad, gleiche `.env`), nginx-Ports unverändert (`127.0.0.1:<port>`).

| Target     | Port | Image                  |
|------------|------|------------------------|
| `free-idp` | 3003 | openape-free-idp       |
| `troop`    | 3010 | openape-troop          |
| `chat`     | 3007 | openape-chat           |
| `org`      | 3020 | openape-org            |

**Fallback (dormant):** die alten systemd-Units (`openape-<app>.service`) sind disabled, aber intakt — Notfall: Container stoppen + `sudo systemctl start openape-<app>` (ubuntu-User). Das alte rsync/systemd-Deploy (`pnpm run deploy`, `scripts/deploy.mjs`) bleibt für `docs` (statisches Site-Deploy) und als Legacy-Pfad erhalten.

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

1. **Nie Source-Code auf `main` editieren** — `/issue-start <nr>` zum Starten verwenden
2. **Branch-Naming:** `<type>/issue-<nr>-<kurzbeschreibung>`
3. **PRs required** — CI muss grün sein vor Merge
4. **Ausnahmen für direct-to-main:** `.claude/`, `.github/`, `.githooks/`, `scripts/`, Config-Dateien

**Enforcement:** Claude-Hook blockiert Edit/Write auf `main` für Source-Dateien. Pre-Commit-Hook und GitHub Ruleset als zusätzliche Barrieren.

## Important Notes

- **`escapes/`** (formerly "sudo") is a separate repo (`openape-ai/escapes`) — not part of this monorepo. `desktop/` (`openape-ai/desktop`) is a separate repo currently being decommissioned/archived.
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
3. Betroffene Packages: `packages/core`, `packages/auth`, `packages/grants`, `modules/nuxt-auth-idp`, `modules/nuxt-auth-sp`, `packages/apes`, `apps/docs`
4. Bei Abweichung von der Spec: **User WARNEN und FRAGEN** ob die Abweichung beabsichtigt ist
5. Spec-Dokumente: `core.md`, `grants.md`, `delegation.md` im Repo `openape-ai/protocol`

Keine stille Abweichung — jede Spec-Inkompatibilität muss explizit bestätigt werden.

## Security Checklist

Jedes sicherheitsrelevante Feature in `@openape/server` ist getestet. Bei Änderungen an Auth, Grants, Sessions oder Endpoints diese Liste prüfen:

**Transport & Headers:**
- [x] Security Headers (X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy) auf allen Responses
- [x] Cache-Control: no-store auf Auth-Responses, public+max-age auf JWKS/Discovery
- [x] CORS Boundaries: API-Endpoints ja, Admin/Session/Authorize nein
- [x] Cookie Security: HttpOnly, SameSite=Lax, MaxAge=7d, Secure nur bei HTTPS

**Authentication & Authorization:**
- [x] Bearer Token Auth (JWT mit act-Claim)
- [x] Session Cookie Auth (Browser-Flow)
- [x] Management Token Auth (Admin-Endpoints, timing-safe Vergleich)
- [x] act-Enforcement: nur act:'human' darf Delegations erstellen und Sub-User registrieren
- [x] Delegation No-Chaining (max 1 Level)

**Cryptography:**
- [x] PKCE S256 Challenge
- [x] JWT Signatur, Issuer, Audience Prüfung
- [x] ed25519 Challenge-Response (32 Bytes, 60s TTL, Single-Use)
- [x] Timing-Safe Token-Vergleich (crypto.timingSafeEqual)
- [x] Code Replay Protection (Code nur 1x tauschbar)

**Input Validation & Rate Limiting:**
- [x] Body Size Limit (100KB)
- [x] String Length Limits (Email/Name 255, PublicKey 1000)
- [x] Rate Limiting auf Auth-Endpoints (konfigurierbar, per-IP)
- [x] ReDoS-sichere Regexes (ESLint-Regel enforced)

**Bei neuen Endpoints prüfen:**
1. Braucht der Endpoint Auth? Welche Art (Bearer, Session, Management Token)?
2. Braucht der Endpoint CORS? (API: ja, Admin/Session: nein)
3. Akzeptiert der Endpoint User-Input? → Input Validation + Body Limit
4. Ist der Endpoint Brute-Force-gefährdet? → Rate Limiting
5. Gibt der Endpoint Secrets zurück? → Cache-Control: no-store
