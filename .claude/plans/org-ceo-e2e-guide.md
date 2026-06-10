# Plan: E2E-Story + Guide „Einen CEO im Org anlegen"

## Ziel
Eine **E2E-Story** (`compose/demo/`-Story-DSL), die den echten Flow „Org anlegen → CEO-Mitglied hinzufügen → Cross-SP-Consent → CEO spawnen → CEO aktiv" durchfährt und daraus den **`/docs`-Guide** der org-App generiert (`org.openape.ai/docs` → „Add a CEO to your org"). Test = Quelle der Wahrheit für die Anleitung (Patrick-Prinzip „Manuals aus E2E").

## Kontext / Befund (verifiziert 2026-06-10)
Der Flow ist **vollständig gebaut**:
- **Org anlegen:** `POST /api/orgs` + `CreateOrgDialog` → `/orgs/{id}` (Story `create-org` existiert schon in `compose/demo/stories/org.mjs`).
- **CEO-Mitglied:** `AddMemberDialog` (role-enum `ceo|teamlead|specialist|sanierer|other`), `POST /api/orgs/{id}/members` → Platzhalter-Row `status='invited'`, Platzhalter-Email `pending+<uuid>@org.openape.ai`.
- **Spawn-Trigger:** Chart-Card „Spawn agent" → `onSpawnAgent()` (`apps/openape-org/app/pages/orgs/[id].vue:186`):
  - `findStandingGrant()` → `GET {idp}/api/grants?role=delegator` mit `credentials:include` (braucht **CORS-Allowlist + sameSite=none** Cookie am IdP).
  - Kein Grant → Bounce auf `{idp}/grant-cross-sp?delegate=org.openape.ai&audience=troop.openape.ai&scopes=troop:spawn-agent&grant_type=always&return_to=…` (M4γ Consent-Page; **existiert**: `modules/nuxt-auth-idp/src/runtime/pages/grant-cross-sp.vue` + `…/server/api/grant-cross-sp.post.ts`).
  - Zurück mit `?grant_id` → `spawnWithGrant()` → `fetchAuthzJwt()` (`POST {idp}/api/grants/{id}/token`) → `POST /api/orgs/{id}/members/{email}/spawn`.
- **Server-Dance** (`apps/openape-org/server/api/orgs/[id]/members/[email]/spawn.post.ts`): `POST {troop}/api/cli/exchange` (scope `troop:spawn-agent`) → `POST {troop}/api/agents/spawn-intent` mit Recipe-Ref aus `role-defaults.ts` (`github.com/openape-ai/agent-catalog/ceo@v0.1.0`, params `{org_id, org_name}`) → Member-Row cached `spawnIntentId`/`spawnStatus='pending'`.
- **Poll + PK-Swap:** Frontend pollt `GET …/spawn-status` (2s) → bei Erfolg Platzhalter-Row löschen, echte Agent-Email-Row `status='active'`.

**Recipe-Pfad selbst ist bereits live bewiesen** (diese Session): troop validiert `ceo@v0.1.0` (schedules:[]-Fix #633 deployed) und der Nest provisioniert den Agent (`spawn result ok:true`, IdP-Identity gemintet) — siehe [[reference_local_stack_agent_lifecycle]].

## Kern-Problem (warum > Story-Datei)
1. **Der Demo-Runner (`compose/demo/run-stories.mjs`) hat KEINEN gebundenen Nest** → der Spawn würde nie „active". Nur der **agent-lifecycle-Run** (`compose/agent/run.sh` → bind.mjs) bindet einen Nest. Die Story muss also im agent-lifecycle-Umfeld laufen, nicht im reinen Demo-Run.
2. **Cross-SP-Consent (M4γ)** muss in der Story durchfahrbar sein: CORS-Allowlist org→idp im local-stack + Consent-Approval per Virtual-Authenticator. **Beides im local-stack unbestätigt** (kein sichtbares CORS-Env in `compose/local-stack.yml`).
3. Die Story braucht eine **Org-SP-Session** (DDISA-SSO in die org-App) zusätzlich zur Owner-IdP-Session.

## Empfohlener Ansatz: **A — im agent-lifecycle-Run**
Neue Story-Datei `compose/agent/org-ceo.mjs` (analog zur diese Session genutzten ceo-spawn-Probe), die NACH `run.sh` (Nest gebunden, Owner-Login provisioniert) läuft, die org-UI über den Virtual-Authenticator-Browser-Context fährt und den Guide-Manifest-Fragment schreibt. So zeigt der Guide den CEO **wirklich aktiv** (echtes E2E), nicht nur „pending".

Alternative B (Fallback, falls Cross-SP im local-stack nicht durchfahrbar): Story im Demo-Run bis „pending"-Card + Consent-Screenshot, Aktivierung im Caption beschrieben. Schwächer (Endzustand beschrieben statt gezeigt) — nur falls A an einem nicht-vertretbaren local-stack-Gap scheitert.

## Milestones (je unabhängig verifizierbar, max. 1/Session)

### M1 — Spike: Flow im laufenden local-stack manuell durchfahren (DE-RISK)
Bevor Story-Code: beweisen, dass org→CEO-Spawn im local-stack E2E geht.
- Skript/headless (Virtual-Authenticator) im laufenden Stack (Nest ist gebunden): org.openape.test einloggen (SSO) → org anlegen → CEO-Member adden → „Spawn agent" → Consent → zurück → poll → `status='active'`.
- **Knackpunkte zu klären:** (a) CORS: erlaubt der local-idp `org.openape.test` als Origin für `credentials:include`? Falls nein → `NUXT_OPENAPE_*CORS*`/Allowlist-Env in `compose/local-stack.yml` ergänzen (idp). (b) Consent-Auto-Approve per Virtual-Authenticator (wie andere DDISA-Approvals in den Stories). (c) troop `/api/cli/exchange` akzeptiert das org-delegierte Token im local-stack.
- **Akzeptanz:** ein manuell/skriptgetriebener Durchlauf endet mit org-Member-Row `status='active'` + realer `ceo-…@id.openape.test`-Email (DB-Query oder UI-Card „active"). Beobachtbarer Output gezeigt.
- **Output des Milestones:** dokumentierte exakte Schritte/Selektoren/etwaige local-stack-Env-Fixes → Input für M2.

### M2 — Story schreiben + verdrahten
- `compose/agent/org-ceo.mjs`: `kit.story({ app:'openape-org', category:'Organizations', id:'add-ceo', title:'Add a CEO to your org', … })` mit Steps (+ Captions als Guide-Text):
  1. „Create the organization" (Name/Vision/Budget) — *shot*
  2. „Add the CEO seat" (AddMemberDialog, role=CEO) — *shot*
  3. „Approve the one-time delegation" (Consent-Page erklärt: org darf in deinem Namen einen Agent auf troop spawnen) — *shot*
  4. „Spawn the CEO" (Card pending → active) — *shot*
  5. „Your CEO is live" (aktive Card, reads vision) — *shot*
- In `compose/agent/run.sh` nach `lifecycle.mjs` (oder als eigener Schritt) `pw org-ceo.mjs` aufrufen; `compose/distribute-docs.mjs` verteilt das Fragment in die org-App (`apps/openape-org/public/docs/stories.json` + screenshots).
- Determinismus: `installDeterminism(page)` nutzen (#632) → byte-stabile Screenshots.
- **Akzeptanz:** `lint`+`typecheck` grün; Story-Datei folgt dem DSL-Vertrag (`story-kit.mjs`).

### M3 — Capture + Guide verifizieren + zeigen
- Vollen agent-lifecycle-Run inkl. `org-ceo.mjs` fahren → screenshots + `stories.json` der org-App.
- org-App `/docs` rendern (headless Chrome) → Guide „Add a CEO to your org" sichtbar, alle Shots vorhanden.
- **Akzeptanz:** (a) Re-Run ohne Code-Änderung = 0 geänderte PNGs (Determinismus, #632). (b) `org.openape.test/docs/add-ceo` zeigt 5 Steps mit Bildern. (c) Screenshot des gerenderten Guides per SendUserFile an Patrick.

## Risiken / offene Fragen
- **R1 (hoch):** Cross-SP-CORS im local-stack evtl. nicht konfiguriert → M1 muss ggf. idp-Env ergänzen. Falls die Allowlist hart an `*.openape.ai` hängt (nicht `.test`), kleiner Code-/Config-Fix nötig.
- **R2 (mittel):** Consent-Approval headless — ob `grant-cross-sp.vue` per Virtual-Authenticator ohne Extra-Tap approvebar ist (sollte wie die anderen DDISA-Approvals gehen).
- **R3 (niedrig):** 2 bestehende agent-Stories sind flaky (UI-Click-Timeout) — die org-Story muss robuste Selektoren/Waits nutzen.
- **R4 (niedrig):** Demo- vs. agent-lifecycle-Runner-Trennung: der org-Guide-Fragment muss korrekt über `distribute-docs.mjs` in die org-App fließen (heute verteilt der agent-Run u.a. idp/troop-Agent-Stories — org ergänzen).

## Entscheidung nötig (vor M2)
1. **Ansatz A (echtes E2E mit aktivem CEO) bestätigen** vs. B (Demo-Run bis pending). → Empfehlung A.
2. M1-Spike jetzt starten? (läuft gegen den bereits gebundenen local-stack — schnellster Weg, R1/R2 zu klären.)

## Status
- [ ] M1 Spike  [ ] M2 Story  [ ] M3 Capture+Verify
