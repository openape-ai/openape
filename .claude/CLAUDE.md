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
  apes/           # @openape/apes — CLI toolkit
  cli-auth/       # @openape/cli-auth — shared CLI auth lib
  proof-cli/      # @openape/proof-cli — shared CLI core for the proof-link apps
  prompt-injection-detector/  # @openape/prompt-injection-detector
  agent-runtime/  # @openape/agent-runtime — in-process agent run loop + tools
  shapes/         # @openape/shapes — adapter parsing, registry, installer
  sp-tasks/       # @openape/sp-tasks — A2A-shaped task queue for service-agents
  codex-proxy/    # @openape/codex-proxy — OpenAI-compatible proxy over Codex
  protocol-conformance/  # @openape/protocol-conformance — DDISA conformance suite (private)
  ape-troop/      # @openape/ape-troop — owner CLI for troop.openape.ai (nests + agents)
  ape-tasks/      # @openape/ape-tasks — CLI for tasks.openape.ai
  ape-testruns/   # @openape/ape-testruns — CLI for testrun.openape.ai
  ape-pr/         # @openape/ape-pr — CLI for pr.openape.ai
  ape-plans/      # @openape/ape-plans — CLI for plans.openape.ai
  ape-timetrack/  # @openape/ape-timetrack — CLI for timetrack.openape.ai
  ape-crm/        # @openape/ape-crm — CLI for crm.openape.ai

modules/          # Publishable Nuxt modules
  nuxt-auth-idp/  # @openape/nuxt-auth-idp — IdP Nuxt module
  nuxt-auth-sp/   # @openape/nuxt-auth-sp — SP Nuxt module (incl. shared DDISA-SP
                  #   CLI auth: requireCaller + /api/cli/me + /api/cli/exchange)

apps/             # Deployable applications (private, not published)
  openape-free-idp/   # Free DDISA IdP → self-hosted (chatty)
  openape-troop/      # Troop control plane (incl. company/org view) → self-hosted (chatty)
  openape-chat/       # Chat app → self-hosted (chatty)
  openape-tasks/      # tasks.openape.ai — shared task lists (app + CLI) → self-hosted (chatty)
  openape-testrun/    # testrun.openape.ai — test-run proof links → self-hosted (chatty)
  openape-pr/         # pr.openape.ai — PR review surface → self-hosted (chatty)
  openape-plans/      # plans.openape.ai — living plans → self-hosted (chatty)
  openape-timetrack/  # timetrack.openape.ai — time tracking → self-hosted (chatty)
  openape-monitor/    # monitor.openape.ai — uptime monitor (checks + mail alerts) → self-hosted (chatty)
  openape-question-service/  # question-service.openape.ai — sp-tasks Q&A surface → self-hosted (chatty)
  openape-crm/        # crm.openape.ai — Deal-Pipeline, Kontakte, Notizen → self-hosted (chatty)
  openape-ape-agent/  # @openape/ape-agent — per-agent runtime process
  openape-chat-cli/   # @openape/ape-chat — CLI for chat.openape.ai
  openape-nest/       # @openape/nest — local control-plane daemon
  openape-llm/        # LLM proxy container (Dockerfile only)
  docs/               # docs.openape.ai → self-hosted (chatty, `pnpm run deploy:docs-site`)

examples/         # Example apps + E2E tests
  idp/            # IdP example app — also the IdP every E2E suite boots
  sp/             # SP example app — also the SP the OIDC E2E suites boot
  e2e/            # E2E integration tests + the shared boot harness
                  #   (`openape-e2e/lifecycle`, `openape-e2e/idp-fixture`)
  agent-recipes/  # Agent recipe examples
```

**E2E fixtures:** tests never re-implement the protocol. `openape-e2e/idp-fixture`
starts `examples/idp` as a `nuxt dev` server on a free port with a throwaway
store; `packages/apes`' IdP-backed suites use it too (they run in the `idp`
vitest project, one Nuxt boot at a time).

**Wenn du eine Suite auf einen echten Server umstellst**, gelten vier Regeln —
jede davon hat in PR #1158 einen eigenen roten CI-Lauf gekostet, obwohl lokal
alles grün war:

1. **`127.0.0.1`, nie `localhost`.** Im CI-Container löst `localhost` zuerst auf
   `::1` auf, während `nuxt dev` auf IPv4 lauscht. Der Server ist gesund, der
   Readiness-Poll erreicht ihn nur nie — Symptom: Timeout mit **leerem** Log.
2. **Eigener HMR-Port pro Server.** Vites HMR-Port ist fest 24678; zwei
   gleichzeitige Dev-Server kollidieren, der Verlierer wird nie ready. Der
   Lifecycle-Helper leitet ihn aus dem App-Port ab (`E2E_HMR_PORT`).
3. **Vor dev-Boot-Suiten die Workspaces bauen.** `ci.yml` und `e2e.yml` haben
   beide einen seriellen Pre-Build; ohne ihn fehlen den Beispiel-Apps die
   Module-Dists.
4. **Timeouts am geteilten Runner bemessen**, nicht am Mac: Boot 300 s,
   `hookTimeout` darüber. Coverage-Floors folgen dem **niedrigeren** Wert von
   mac/linux (linux misst ~0,5 pp darunter).

**Diagnose vor Reparatur.** Fünf begründete Fix-Versuche an #1158 lagen daneben;
gefunden hat es erst ein Wegwerf-Schritt, der den Boot isoliert ausführt und
alles ausgibt. Schweigt ein Prozess, ist die Frage nicht „wie lange warten wir",
sondern „reden wir überhaupt mit ihm".

## Dependency Graph (Publish Order)

`packages/core` ist die Wurzel (keine internen Deps); alles andere hängt direkt
oder transitiv daran. Der vollständige, aktuelle Überblick steht in
`ARCHITECTURE.md` („Building blocks"); die **maßgebliche Publish-Reihenfolge**
ist die manuell gepflegte `PACKAGES`-Liste in `scripts/publish-chain.mjs` —
neue publishable Packages dort VOR ihren Consumern eintragen. Kein Graph mehr
hier: die frühere 6-Package-Skizze war gegenüber den real ~18 Packages
veraltet (Drift-Fund des arch-extract-Laufs, 2026-06-11).

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

Uses Changesets with a single root `.changeset/config.json`. **Publishing is local** — es gibt KEINEN CI-Release-Workflow (`.forgejo/workflows/` hat nur `ci`/`e2e`/`preview`; kein `release.yml`). `scripts/publish-chain.mjs` baut + published in Dependency-Reihenfolge (`pnpm publish --access public --ignore-scripts`, **ohne** `--provenance` — dafür bräuchte es GH-Actions-OIDC).

1. `pnpm changeset` — pro Änderung einen Changeset anlegen
2. `pnpm version-packages` (= `changeset version`) — Changesets konsumieren, Versionen + CHANGELOGs bumpen
3. `pnpm release:dry` — prüfen, was published würde; dann `pnpm release` — published zu npm (npm-Login als Maintainer nötig)
4. `main` ist protected → den „version packages"-Commit per Branch + PR + grünem CI mergen (kein Direct-Push)

> **publish-chain `PACKAGES`-Liste ist manuell** (nicht aus `private:false` abgeleitet): neue publishable Packages dort in Dependency-Reihenfolge VOR ihren Consumern eintragen, sonst zeigt ein Consumer auf eine nicht-existente npm-Version.

## Deploy Flow

**Prod = tested images** (seit 2026-06-10): die Web-Apps laufen als Container aus `registry.openape.ai`, orchestriert von `scripts/deploy-image.mjs` + `compose/chatty.yml` (auf chatty unter `/home/openape/prod/`, compose-Projekt `openape-prod`).

```bash
pnpm run deploy:image <target...>   # free-idp | troop | chat | testrun | tasks | pr | plans | timetrack | monitor | question-service | dashboard | crm
pnpm run deploy:image --all
```

Ablauf pro Target: turbo build (.output, Mac, warme Caches) → COPY-only amd64-Image (`compose/preview-package.Dockerfile`, identisches Artefakt-Format wie die PR-Previews, Tag `prod-<sha>`) → lokaler Smoke-Test (`/api/health`) → push → chatty pullt + `compose up` → externes Health-Gate → bei Fehler automatischer Rollback auf `<APP>_TAG_PREV`. Kein Build auf chatty. Die Container mounten das bestehende `/home/openape/projects/<app>/shared` (gleicher Pfad, gleiche `.env`), nginx-Ports unverändert (`127.0.0.1:<port>`).

| Target       | Port | Image                  |
|--------------|------|------------------------|
| `free-idp`   | 3003 | openape-free-idp       |
| `troop`      | 3010 | openape-troop          |
| `chat`       | 3007 | openape-chat           |
| `tasks`      | 3005 | openape-tasks          |
| `plans`      | 3004 | openape-plans          |
| `testrun`    | 3006 | openape-testrun        |
| `timetrack`  | 3011 | openape-timetrack      |
| `monitor`    | 3018 | openape-monitor        |
| `question-service` | 3017 | openape-question-service |
| `pr`         | 3014 | openape-pr             |
| `dashboard`  | 3022 | openape-dashboard      |
| `crm`        | 3024 | openape-crm            |

**Docs-Site (eigener Pfad):** `docs.openape.ai` läuft nicht über `deploy:image`, sondern über `pnpm run deploy:docs-site` (`scripts/deploy-docs-site.mjs` + `compose/docs-site.yml`). Gleiches Muster — `pnpm turbo run build --filter docs` → `apps/docs/.output/public` in ein amd64-Caddy-Image (`compose/site.Dockerfile`, Image `site-docs`) → Smoke-Test → push → chatty pullt. Der Container hängt am `coolify`-Netz hinter Traefik (keine publizierten Ports), compose-Projekt `site-docs` unter `/home/openape/prod-site-docs`, Tag-Pin `DOCS_TAG` / Rollback `DOCS_TAG_PREV`.

**Fallback (dormant):** die alten systemd-Units (`openape-<app>.service`) sind disabled, aber intakt — Notfall: Container stoppen + `sudo systemctl start openape-<app>` (ubuntu-User). Der dazugehörige rsync/systemd-Deploy (`pnpm run deploy`, `scripts/deploy.mjs`) ist der Notfallpfad auf genau diese Units und kennt nur drei Targets: `troop`, `chat`, `free-idp` (je `scripts/deploy-<t>.sh`: build → rsync nach `releases/<TS>` → `current`-Symlink → `systemctl restart` → Health-Check). `docs` ist dort **kein** Target.

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

## Policy: UI wird mit Komponenten-Tests entwickelt

**Beschlossen 2026-08-04** (Karte `01KZ5NT798X8WJGPBHSMQKC041` auf troop.openape.ai, Entscheidung: „CLAUDE.md + policy-Events").

Vue-Komponenten mit sichtbarer Logik — Zustände, Verzweigungen, Interaktionen — bekommen einen Komponenten-Test. Ein Screenshot ist ein Blick, kein Test: Der erste Testlauf der `DecisionCard` fand einen Defekt, den kein Screenshot zeigt (`Nur vor dem Merge(Empfehlung)` — das Leerzeichen existierte nur als CSS-Margin).

- **Logik zuerst herausziehen.** Reine Funktionen leben in `app/utils/*.ts` und werden dort getestet (Beispiel: `attention-inbox.ts` — Fold über Events, Titel, Wartezeit). Die Komponente testet dann nur Darstellung und Interaktion.
- **Setup pro App:** `@vitejs/plugin-vue` in der vitest-Config, `@vue/test-utils` + `happy-dom`, Nuxt-UI-Komponenten als Stubs. Vorlage: `apps/openape-troop/vitest.config.ts` + `tests/decision-card.test.ts`.
- **Assertions auf sichtbaren Text und emittierte Events**, nicht auf CSS-Klassen oder interne Struktur.
- **Nicht nötig** für reine Darstellungs-Einzeiler ohne Verzweigung. Kein Snapshot-Testing ganzer Seiten.
- **Niemals** stattdessen die Auth aushebeln, um eine eingeloggte Ansicht zu Gesicht zu bekommen — genau dieser Umweg war der Anlass für die Regel.

Bestandsaufnahme über alle Apps und die Frage nach gemeinsamen Komponenten: Issue #1172.

### Alles, was Geometrie ist, gehört in den Browser-Modus

**Beschlossen 2026-08-04** (Patrick, nach dem Organigramm-Bug: eine Karte war auf dem Handy breiter als der Bildschirm, und der Komponenten-Test blieb grün).

happy-dom rechnet kein Layout: `offsetWidth` ist dort immer 0, Media-Queries werden nicht ausgewertet, und die Kaskade über mehrere SFC-`<style>`-Blöcke existiert nicht. Sichtbare Größen, Überläufe, Breakpoints und Dark-Mode prüft deshalb der Vitest-Browser-Modus (Vorlage `apps/openape-troop/vitest.browser.config.ts` + `tests/layout/`). Ein Lauf dauert ~3 s.

Drei Pakete haben ein `test:layout`, und der `layout`-Workflow fährt jedes in einem **eigenen Schritt** — ein `pnpm --filter a --filter b test:layout` überspringt ein fehlendes Script still (kein `requiredScripts` in `pnpm-workspace.yaml`) und bliebe grün, ohne etwas zu prüfen:

| Paket | was dort eigenes CSS ist |
|---|---|
| `@openape/troop` | `AppHeader`, Organigramm (`.org-*`) |
| `@openape/nuxt-auth-sp` | `OpenApeAuth` — die Login-Karte, die auf fremden Hosts steht |
| `@openape-testrun/app` | Screenshot-Rahmen `.shot*` und `.prose-report` der Report-Seite |

- **Wann Browser-Modus:** alles, was eine Größe, eine Position oder einen Breakpoint hat. **Wann weiter happy-dom:** Zustände, Verzweigungen, Texte, emittierte Events — das ist schneller und braucht keinen Browser.
- **Kein Binary-Download:** der Provider fährt das installierte Google Chrome (`launchOptions.executablePath`, überschreibbar per `CHROME_PATH`). Deshalb läuft der `layout`-Workflow auf dem `mac`-Runner — der `docker`-Runner von ci/e2e hat keinen Browser.
- **Falle 1 — es gibt kein Tailwind.** Ein Mount bringt nur die eigenen `<style>`-Blöcke der Komponente mit. Utilities wie `px-3`, `flex` oder `text-sm` kommen aus dem Nuxt-Build und existieren hier schlicht nicht; gemessen wird dann der nackte Browser-Default (Times, kein Padding). **Ein Layout-Test lohnt deshalb nur für Komponenten, deren Geometrie in eigenem CSS steht** — `OrgNode.vue`/`Chart.vue` mit ihren `.org-*`-Regeln, oder `AppHeader.vue`, das sein Layout genau deswegen als Komponenten-CSS trägt. Für eine Tailwind-only-Komponente misst der Test Scheinwerte; dort lieber keinen schreiben, als einen, der Sicherheit vortäuscht. `tests/layout/setup.ts` liefert nur den `box-sizing`-Preflight, ohne den jede gepolsterte Box zusätzlich 26 px zu breit misst.
  - **Das setup darf keine Regel liefern, die die Komponente selbst trägt.** Sonst hält der Test die Komponente hoch und behauptet, sie stehe allein: `.shot img{max-width:100%}` sah in testrun grün aus, bis das `img{max-width:100%}` aus dem Preflight raus war — dieselbe Regel, zweimal, und der Test hätte ihren Verlust nie gemeldet. `modules/nuxt-auth-sp` geht deshalb ganz ohne Preflight ins Rennen: die eingebettete Login-Karte bringt ihr `box-sizing` selbst mit, und genau das soll der Test prüfen können.
- **Jeder Layout-Test braucht seinen Gegenbeweis.** Regel aus dem SFC entfernen → Test muss rot werden. Wird er es nicht, misst er entweder das Preflight (siehe oben) oder gar nichts. Das ist auch der einzige Weg, eine Regel als überflüssig zu erkennen: `.shot{max-width:100%}` ist neben `width:fit-content` wirkungslos, weil `fit-content` ohnehin bei der verfügbaren Breite deckelt.
- **Falle 2 — String-Templates rendern nicht.** Der Browser-Build von Vue bringt keinen Compiler mit, also erzeugt ein Stub mit `template: '<button>…'` **nichts**. Ein Baum aus leeren Kästen besteht jede Breiten-Assertion — der Test misst dann seinen eigenen blinden Fleck. Stubs deshalb als `render`-Funktionen schreiben und eine Assertion mitgeben, die bestätigt, dass die Stubs überhaupt im DOM stehen.
- **Falle 3 — Style-Reihenfolge ist die der Importe.** Vite injiziert SFC-Styles in Import-Reihenfolge der Testdatei, nicht in Bundle-Reihenfolge. Bei einem Kaskaden-Gleichstand zwischen zwei Komponenten entscheidet damit die Importzeile über rot oder grün (im Organigramm-Fall: `671 > 390` oder „passt"). Importiere deshalb wie im Build ausgewertet wird — Kind vor Elternteil — und sichere die Ursache zusätzlich im Quelltext ab, wenn sie eine Duplikat-Regel ist.

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

OpenApe implementiert das DDISA-Protokoll. Die formale Spezifikation liegt im Repo `openape-ai/protocol` auf **git.openape.ai** (lokal: `~/Companies/private/repos/openape/protocol`). Wie bei allen OpenApe-Repos ist Forgejo das Original und GitHub nur der Mirror — Spec-Änderungen gehen als PR nach git.openape.ai, nie nach GitHub.

**Pflicht bei jeder Änderung an protokollrelevanten Dateien:**

1. Prüfe ob die Änderung mit der DDISA-Spec kompatibel ist
2. Protokollrelevante Bereiche: DNS Discovery, Auth Flow, JWT Claims, Grant API, Delegation API, Error Format, Well-Known Endpoints
3. Betroffene Packages: `packages/core`, `packages/auth`, `packages/grants`, `modules/nuxt-auth-idp`, `modules/nuxt-auth-sp`, `packages/apes`, `apps/docs`
4. Bei Abweichung von der Spec: **User WARNEN und FRAGEN** ob die Abweichung beabsichtigt ist
5. Spec-Dokumente: `core.md`, `grants.md`, `delegation.md` im Repo `openape-ai/protocol`

Keine stille Abweichung — jede Spec-Inkompatibilität muss explizit bestätigt werden.

## Security Checklist

Die sicherheitsrelevanten IdP-Features leben in `modules/nuxt-auth-idp` (Handler,
Plugins, Stores). Bei Änderungen an Auth, Grants, Sessions oder Endpoints diese
Liste prüfen:

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
