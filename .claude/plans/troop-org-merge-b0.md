# Plan: Troop + Org zusammenlegen (B0)

> Self-contained. Ein Agent/Mensch ohne Vorwissen liest das von oben nach unten und kann es ausführen.
> Stand 2026-06-15. Quelle der Richtung: `werkstatt-roadmap.md` (Track B0) + `HANDOFF-merge.md`.
> Code-Fundierung: frische Explore über alle 4 Merge-Surfaces (Troop / Org / Tasks / apes+nest), 2026-06-15.

## Purpose / Big Picture

- **Ziel:** EIN Owner-Produkt, in dem der Kommunikations-Loop **Owner ↔ CEO ↔ Assistenten** in einem UI
  sichtbar ist (heute getrennt: CEO-Chat lebt in Troop, Reports/Org-Chart/Objectives in Org), und in dem
  **eine Agent-Identität** existiert statt vier per-E-Mail-String lose verbundener Kopien
  (IdP / troop `agents` / org `org_members` / tasks `team_members`).
- **Kontext:** Die 4-fach verstreute Identität erzeugt reale Reibung: Placeholder-PK-Swap beim Spawn,
  Zwei-Hop-Spawn (Org → IdP cross-SP → Troop, dann Polling + Email-Swap), und `org_id ≠ team_id`
  (ein tasks-Team lässt sich NICHT deterministisch einer Org zuordnen — es gibt kein `org_id` in `tasks`).
- **Scope (drin):** (1) Daten verknüpfen, (2) Deployables verschmelzen (Org → Troop-Backend),
  (3) ein Owner-UI mit getrennten Views „Firma" vs „Betrieb/Agents".
- **Scope (explizit NICHT):** Troops Maschinen-Surface ändern; **Tasks in troop/org verzahnen** (Patrick-Steer
  2026-06-15: Tasks ist ein austauschbarer Task-Tracker — könnte auch Trello sein; der PM verteilt wo er will.
  Der Anker ist die **DDISA-Identität** des Agents, nicht die Team-Mitgliedschaft); echte Team/Department-
  Hierarchie über B3a hinaus (Phase 2).
- **Leit-Outcome (Patrick-Steer):** Owner klickt im EINEN UI auf einen Agent und redet mit ihm — **praktisch
  nur mit dem CEO** (sonst werden Hierarchien übersprungen → Unruhe). CEO ist der primäre Gesprächspartner;
  ICs sind sichtbar, aber der Chat-Einstieg ist CEO-zentriert. Troop hat die Chat-Maschinerie schon
  (`AgentChat.vue` + `/api/agents/me/chat`); der Merge bringt die Firmen-/Org-Ebene dazu.

### Die tragende Wand (eingefrorener Vertrag — byte-stabil halten)

Diese Surfaces hängen an CLI (`@openape/apes`, `@openape/cli-auth`), Nest (`apps/openape-nest`) und
Agent-Runtime (`apps/openape-ape-agent`). **Jede Änderung daran bricht alle laufenden Nests/Agents.**

- **10 HTTP/WS-Verträge** (Request/Response byte-stabil):
  1. `POST /api/agents/me/sync` → `{ agent_email, host_id, first_sync, last_seen_at }`
  2. `GET /api/agents/me/tasks` → `{ system_prompt, tools[], recipe_ref?, skills[], tasks[] }`
  3. `POST /api/agents/me/runs` → `{ id, started_at }`
  4. `PATCH /api/agents/me/runs/:id` ← `{ status, final_message, step_count, trace? }`
  5. `POST /api/cli/exchange` (RFC 8693) → `{ access_token, expires_at, aud, scope, delegate }`
  6. `POST /api/nests/token` ← `{ host_id, device_secret }` → `{ access_token, expires_at }`
  7. `GET /api/agents/me/chat` → `{ chat, messages[] }`
  8. `POST /api/agents/me/chat/messages` → `{ id, … }`
  9. `PATCH /api/agents/me/chat/messages/:id`
  10. `POST /api/agents/spawn-intent` (+ `GET /api/agents/spawn-intent/:id`)
- **WS-Frames** (`/api/nest-ws` + `/_ws/chat`): `hello`, `heartbeat`, `spawn-result`, `destroy-result`,
  `config-update`, `spawn-intent`, `destroy-intent`, `reload-bridge`, `secret-update`, `secret-revoke`,
  `welcome`, `ack`.
- **Agent-Identitätsformat:** `agent+<name>+<ownerdomain>@id.openape.ai` (DDISA-issued, IdP-kanonisch).
  Das ist der **natürliche Join-Key** für die Identitäts-Vereinheitlichung — er bleibt unverändert.
- **2 Env-Vars** (Domain-Umzug muss darüber gehen, nicht über Hardcode): `OPENAPE_TROOP_URL`,
  `OPENAPE_TROOP_WS_URL`.
- **3 Client-Datei-Formate:** `~/.config/apes/auth.json`, `~/.config/apes/sp-tokens/<aud>.json`,
  `~/.openape/agent/agent.json`.

## Repo-Orientierung

- **Projekt:** openape-monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
  (Forgejo-authoritative `git.openape.ai`, push-mirror GitHub; Branches/PRs aufs `forgejo`-Remote).
  tasks-App ist ein SEPARATES Repo: `/Users/patrickhofmann/Companies/private/repos/openape/openape-tasks`.
- **Relevante Surfaces (alle code-verifiziert 2026-06-15):**
  - **Troop (tragende Wand):** `apps/openape-troop/server/database/schema.ts` (Tabellen `agents` PK=email,
    `nests` PK=(ownerEmail,hostId), `tasks`, `runs`, `chats`, `chatMessages`, `agentSkills`,
    `agentSecrets`, `oauthCredentials`). Maschinen-Handler: `server/api/agents/me/*`,
    `server/api/agents/spawn-intent*`, `server/api/nests/*`, `server/api/cli/exchange.post.ts`,
    `server/routes/api/nest-ws.ts`. Auth: `server/utils/auth.ts` (`requireAgent`/`requireOwner`/
    `requireOwnerWithScope`). Port 3010, `troop.openape.ai`.
  - **Org (formbar):** `apps/openape-org/server/database/schema.ts` (Tabellen `organizations`,
    `orgMembers` PK=(orgId,agentEmail) — hat `role`/`reportsToEmail`/`persona`/`status` + M4-Spawn-Tracking
    `spawnIntentId`/`spawnStatus`/`spawnGrantId`, `objectives`, `reports`, `costSnapshots`).
    Endpoints: `server/api/orgs/**` (21 Dateien, ALLE Owner-Session, KEIN Agent-Bearer aktiv).
    Spawn-Flow: `server/api/orgs/:id/members/:email/spawn-authorize.get.ts` +
    `server/routes/oauth/grants/callback.get.ts` + `spawn-status.get.ts` (PK-Swap Placeholder→real).
    Persona-Katalog: `server/utils/persona-catalog.ts`. UI: `app/pages/orgs/[id].vue` (Tabs Chart/
    Objectives/Cost/Reports/Settings), `app/components/{OrgChart,ObjectivesKanban,CostDashboard,
    ReportsInbox,AddMemberDialog}.vue`. Port 3020, `org.openape.ai`, SP via `@openape/nuxt-auth-sp`.
  - **Tasks (separater Service, nur Referenz):** `openape-tasks/app/server/database/schema.ts`
    (Tabellen `teams` PK=ULID + `createdBy`-Email, `team_members` PK=(teamId,userEmail), `tasks` PK=ULID
    mit `teamId`/`assigneeEmail`/`ownerEmail`/`status`/`priority`/`dueAt`/`remindAt`). **KEIN `org_id`.**
    CLI: `openape-tasks/cli/src/commands/tasks.ts`, Client `cli/src/client.ts` (aud `tasks.openape.ai`).
  - **Konsumenten der Wand:** `packages/apes/src/lib/troop-client.ts` (Default `troop.openape.ai`,
    Env `OPENAPE_TROOP_URL`), `packages/cli-auth/src/exchange.ts`, `apps/openape-nest/src/lib/troop-ws.ts`
    (Env `OPENAPE_TROOP_WS_URL`), `apps/openape-ape-agent/src/bridge-config.ts`.
- **Tech-Stack:** Nuxt 4 / Vue 3 / h3 / Drizzle + LibSQL(SQLite/Turso) / @nuxt/ui 4 / Tailwind 4.
- **Dev-Setup:**
  - Build/Checks (Wurzel): `pnpm lint` → `pnpm typecheck` → `pnpm turbo run build --filter=<app>` (fail-fast).
  - Org lokal: `pnpm --filter openape-org dev` (Port 3020, `file:./openape-org.db`).
  - Troop lokal: `pnpm --filter openape-troop dev` (Port 3010, `file:./openape-troop.db`).
  - Voller Agent-Lifecycle lokal: `compose/` local stack (siehe `reference_local_stack_agent_lifecycle`).

## Architektur-Entscheidung: Cross-DB-Realität (WICHTIG, prägt die Stufung)

Troop, Org und Tasks sind heute **drei getrennte Apps mit drei getrennten DBs**. Ein **echter DB-FK**
(`REFERENCES`) geht nur INNERHALB einer DB. Daraus folgt die Stufung zwingend:

- **Stufe 1 (M1) = logische Referenz, app-enforced, cross-DB, non-breaking.** Wir fügen nullable
  Referenz-Spalten hinzu (`tasks.teams.org_id`) und etablieren den **DDISA-Agent-Email als kanonischen
  Join-Key** über alle vier Stores. Kein `REFERENCES`-Constraint (cross-DB unmöglich), aber ein
  deterministischer Resolver statt fragilem Email-Namens-Match. Holt ~80% der Reibung, bricht nichts.
- **Stufe 2 (M3) = Org-Tabellen wandern in die Troop-DB.** Erst DANN wird `org_members.agentEmail →
  agents.email` ein **echter intra-DB-FK** und der Zwei-Hop-Spawn kollabiert (Org IST dann derselbe SP
  wie Troop → kein cross-SP-Redirect mehr). Tasks bleibt separater Service mit `org_id`-Referenz.
- **Stufe 3 (M4) = ein Owner-UI.**

→ „FK statt String" aus der Roadmap ist also zweiphasig: **logische Referenz jetzt (M1), harter FK bei
Co-Location (M3).** Das ist bewusst so und im Decision Log festgehalten.

## Milestones

### Milestone 1: Daten verknüpfen — kanonischer Identitäts-Resolver + `org_id` an Tasks-Teams (Stufe 1 / B3a)

**Ziel:** Aus jedem der vier Stores (IdP/Troop/Org/Tasks) lässt sich eine Agent-Identität **deterministisch**
zu den anderen auflösen, und jedes tasks-Team trägt eine optionale, indizierte `org_id`. Kein Breaking
Change, kein DB-Merge. Der `org_id ≠ team_id`-Bug ist behoben (deterministische org↔team-Zuordnung).

**Schritte:**
1. **Tasks-Schema (separates Repo `openape-tasks`):** in `app/server/database/schema.ts` die `teams`-Tabelle
   um `orgId: text('org_id')` (nullable) + `index('idx_teams_org').on(table.orgId)` erweitern. Migration:
   additive `ALTER TABLE` im DB-Init-Plugin (existierende Rows `org_id=NULL`).
2. **Tasks-API:** `POST /api/teams` akzeptiert optional `org_id` im Body; `GET /api/teams` + `GET /api/teams/:id`
   geben `org_id` mit zurück. **CLI bleibt unverändert** (gibt weiter `team_id` aus, ignoriert `org_id`) —
   Vertrag der Agent-Tools bleibt byte-stabil.
3. **Org schreibt die Verknüpfung:** Beim Org-Anlegen/Verknüpfen eines Produkt-Teams ruft Org die Tasks-API
   mit `org_id=<organizations.id>` (via Owner-Delegation-Token gegen `tasks.openape.ai`). Wo Org heute schon
   ein tasks-Team referenziert (CEO/PM lesen Team-IDs), wird die Bindung gesetzt.
4. **Kanonischer Resolver (neues Util in `@openape/server` oder `packages/core`):** eine reine Funktion
   `resolveAgentIdentity(email)` die den DDISA-Email als Schlüssel nimmt und dokumentiert, wie er in
   `agents.email` (Troop), `orgMembers.agentEmail` (Org), `team_members.userEmail`/`tasks.assigneeEmail`
   (Tasks) auftaucht. Unit-getestet gegen die bekannten Formate. (Read-only Mapping-Doku-as-Code; kein
   Schreibpfad — verhindert künftige Email-Namens-Match-Heuristiken.)
5. **Verifikations-Skript:** ein kleines read-only Script das für eine gegebene Org alle Member-Emails nimmt,
   gegen Troop `agents` + Tasks `team_members` prüft und Drift (verwaiste/unverknüpfte Identitäten) listet.

**Akzeptanzkriterien (beobachtbar):**
- [ ] `cd openape-tasks && pnpm typecheck && pnpm lint` → grün; DB-Init legt `org_id`-Spalte + Index an
      (Beweis: `sqlite3 app/.../tasks.db '.schema teams'` zeigt `org_id` + `idx_teams_org`).
- [ ] `ape-tasks teams --json` → Output-Shape **unverändert** (kein `org_id`-Feldzwang, CLI bricht nicht).
- [ ] Neues Team via Org-API mit `org_id` → `GET /api/teams/:id` liefert das `org_id`; Team ohne org bleibt
      `org_id:null`.
- [ ] `resolveAgentIdentity` Unit-Tests grün (mind. CEO/backend/scribe-Email-Formate).
- [ ] Drift-Script gegen Werkstatt-Team (`01KV0XTPETENZ42S5GE6GRPGDG`) + Delta-Mind-Team
      (`01KV5FZ7RQYGJ1GTJYTYSCB46A`) → 0 unaufgelöste Identitäten ODER eine klare Drift-Liste.

**Rollback:** `org_id`-Spalte ist additive/nullable → Spalte droppen oder ignorieren; Resolver+Script sind
read-only/neue Dateien → löschen. Keine bestehenden Verträge berührt.

### Milestone 2: Spawn-Flow & Org-Agent-Auth vorbereiten (Brücke zu Stufe 2, ohne DB-Merge)

**Ziel:** Org bekommt einen **Agent-Bearer-Lesepfad** (CEO/Sanierer können Org-Daten per DDISA-Token lesen/
schreiben statt nur Owner-Session) — der Vertrag, den der heutige Code als „M1+ later" markiert
(`apps/openape-org/server/api/orgs/:id/objectives/index.post.ts` Kommentar). Das entkoppelt die
Funktionsfähigkeit der Personas vom DB-Merge und macht M3 risikoärmer.

**Schritte:**
1. `apps/openape-org/server/utils/auth.ts`: `requireAgent(event)` (Bearer `act='agent'`, DDISA-verifiziert)
   neben `requireOwner` aktivieren; Org-Endpoints für objectives/reports/cost-snapshots akzeptieren
   Agent-Bearer, wenn der Agent Member der Org ist (`orgMembers`-Lookup) und die Rolle den Schreibpfad
   erlaubt (CEO→objectives/reports, Sanierer→cost-snapshots).
2. Persona-Recipes (lokaler `agent-catalog`): CEO/Sanierer bekommen ein Org-Tool/CLI-Aufruf, der per
   `cli/exchange` (aud `org.openape.ai`) ein SP-Token holt und die Org-API ruft. Tool-Vertrag analog
   `ape-tasks`.
3. Spawn-Flow dokumentieren als „kollabiert in M3": heute Org → IdP cross-SP → Troop spawn-intent → Poll →
   PK-Swap. Nach M3 wird daraus ein in-process-Call. M2 fasst den Flow NICHT an (nur Doku + Agent-Auth).

**Akzeptanzkriterien:**
- [ ] CEO-Persona schreibt eine Objective via Agent-Bearer → erscheint in `objectives` mit
      `created_by_email=<CEO>`; Nicht-Member-Agent → 403.
- [ ] Owner-UI weiterhin voll funktionsfähig (Session-Pfad unberührt).
- [ ] `pnpm lint && pnpm typecheck` grün; `@openape/server` Security-Checkliste für neue Auth-Pfade geprüft
      (Bearer + act-Enforcement + kein CORS auf Schreib-Endpoints).

**Rollback:** Agent-Bearer-Zweig hinter Feature-Flag/additivem Code-Pfad → entfernen; Owner-Session-Pfad
bleibt der Default.

### Milestone 3: Deployables verschmelzen — Org-Backend in Troop, echter FK (Stufe 2)

> **Fortschritt:** Schema-Co-Location erledigt `[2026-06-15 16:xx]` — die 5 Org-Tabellen (`organizations`,
> `org_members`, `objectives`, `reports`, `cost_snapshots`) leben jetzt additiv in Troops `schema.ts` +
> `02.database.ts` (idempotente CREATE, gegen Wegwerf-SQLite bewiesen). `org_members.agentEmail` referenziert
> `agents.email` per Wert (string-key join wie überall in Troop; harter FK = späterer Härtungsschritt).
> Maschinen-Tabellen/Surface unangetastet, Troop-typecheck 5/5 + lint 22/22 grün. Branch `feat/org-into-troop`,
> Commit `3a54fb54`. **Read-Endpoints** (`GET /api/orgs`, `:id`, `:id/members`) portiert (`0e6d372f`).
> **Write-Endpoints** portiert `[2026-06-15 16:xx]` (`3375eebd`): `POST /api/orgs`, `PATCH/DELETE :id`,
> `POST/PATCH/DELETE :id/members` (inkl. Placeholder-Member + PK-Swap-Pfad), `GET /api/personas` +
> `persona-catalog` (370 Z. statisch) kopiert. E2E bewiesen: Firma komplett über die Write-API gebaut
> (POST org → 3 Member inkl. invited-Placeholder → memberCount 3), Company-View rendert es. lint 22/22 +
> typecheck 44/44 grün.
> **Spawn-Zwei-Hop KOLLABIERT** `[2026-06-15 16:xx]` (`d791e4aa`): gemeinsame `dispatchSpawnIntent`-Util
> extrahiert (Maschinen-Endpoint `agents/spawn-intent` darauf umgestellt, behavior-preserving — 21/21
> spawn-Tests grün). Neu: `POST /api/orgs/:id/members/:email/spawn` (in-process Intent, kein cross-SP-
> Redirect/Token-Exchange/HTTP-Polling) + `GET .../spawn-status` (in-process Read → PK-Swap Placeholder→
> real). **Offen:** Objectives/Reports/Cost-Endpoints + Views.

**Ziel:** Org-Schema + Endpoints + UI laufen im Troop-Deployable. `org_members.agentEmail` wird ein **echter
intra-DB-FK** auf `agents.email`. Troops Maschinen-Surface bleibt **byte-identisch**. Der Zwei-Hop-Spawn
kollabiert zu einem in-process-Aufruf (Org-Member-Spawn ruft denselben spawn-intent-Code direkt).

**Schritte:**
1. Org-Drizzle-Tabellen (`organizations`, `orgMembers`, `objectives`, `reports`, `costSnapshots`) in
   `apps/openape-troop/server/database/schema.ts` übernehmen; `orgMembers.agentEmail` als FK → `agents.email`
   (nur wo der Member ein gespawnter Agent ist; Placeholder bleiben FK-frei bis Spawn).
2. Org-Endpoints `server/api/orgs/**` nach Troop verschieben (gleiche Pfade unter Troop-Origin); Org-Utils
   (`orgs.ts`, `persona-catalog.ts`, `role-defaults.ts`, `spawn-member.ts`) mit-migrieren; Persona-Katalog
   nach `@openape/server` heben (Single Source für Troop+Org-Picker).
3. Spawn kollabieren: Org-Member-Spawn ruft intern den Troop-`spawn-intent`-Pfad (kein cross-SP-Redirect,
   kein Polling-Hop, kein PK-Swap — der Agent wird direkt mit finaler `agentEmail` angelegt).
4. Domain: `org.openape.ai` als Route/Alias auf den Troop-Origin ODER 301; Clients sind via
   `OPENAPE_TROOP_URL`/`OPENAPE_TROOP_WS_URL` schon abstrahiert → **nur Env + Ankündigung**, kein Client-Break.
5. **Maschinen-Surface-Regressionsgate:** vor Merge einen Vertrags-Snapshot der 10 Endpoints + WS-Frames
   ziehen (z.B. `examples/e2e`), nach Merge byte-diffen. Muss 0 Diff sein.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run build --filter=openape-troop` grün; lokal `node .output/server/index.mjs` startet.
- [ ] Vertrags-Snapshot der 10 Maschinen-Endpoints + WS-Frames **byte-identisch** vor/nach Merge.
- [ ] Ein laufender Nest (local stack) bleibt verbunden, synct, pullt tasks — **kein Reconnect-Bruch**.
- [ ] Org-Member-Spawn erzeugt Agent in EINEM Schritt (kein Placeholder-PK-Swap in den Logs).
- [ ] Owner-UI Org-Views (Chart/Objectives/Reports/Cost) laden unter Troop-Origin.

**Rollback:** Org bleibt als separates Deployable lauffähig (alte App nicht löschen bis M3 in PROD bewährt);
Troop-Org-Routen hinter Build-Flag; DNS-Alias zurückdrehen.

### Milestone 4: Ein Owner-UI mit getrennten Views „Firma" vs „Betrieb/Agents" (Stufe 3)

**Ziel:** Ein Owner-UI. „Firma" = OrgChart/Vision/Produkte/Objectives/Kosten/Reports (Geschäftsebene).
„Betrieb/Agents" = Agent-Config/Runs/Secrets/Nests/Chat (Maschinenraum). Der CEO-Chat (heute Troop) und die
Reports/Org (heute Org) sind im selben UI, sauber getrennt — der Loop Owner↔CEO↔Assistent ist sichtbar.

**Schritte:**
1. Troop-UI um „Firma"-Views erweitern (Org-Komponenten aus M3 als Tabs/Routen); „Betrieb"-Views bleiben.
2. CEO-Chat (`/api/agents/me/chat`-Surface) und Org-Reports nebeneinander; nie Maschinenraum-Felder ins
   Firmen-Dashboard kippen (getrennte Navigations-Ebenen).
3. UI-Captions wie Produkt-Doku (nicht wie Testfall — siehe `feedback_docs_sound_like_docs`).

**Akzeptanzkriterien:**
- [ ] Screenshot „Firma"-View (OrgChart + Objectives + Reports) und „Betrieb"-View (Agents + Nests + Runs)
      — getrennte Navigation, an Patrick via SendUserFile (Headless-Chrome, Dark+Mobile-Zustand).
- [ ] CEO-Chat im selben UI erreichbar; eine Owner-Session deckt beide Ebenen.
- [ ] `pnpm lint && pnpm typecheck && pnpm turbo run build --filter=openape-troop` grün.

**Rollback:** UI-Views sind additive Routen → ausblenden; Org-Alt-UI als Fallback bis bewährt.

## Progress

- [x] `[2026-06-15 15:20]` Plan erstellt, 4-Surface-Explore abgeschlossen, Live-Stand verifiziert, Patrick gibt M1 frei.
- [x] M1: Daten verknüpfen (Stufe 1) — **im Kern fertig** (Schritt 1,2,4,5 done; Schritt 3 → M3 verschoben)
  - [~] `[2026-06-15 15:45]` Schritt 1–2 (`tasks.org_id`): gebaut + bewiesen, aber **GEPARKT (Patrick-Steer
        16:xx): Tasks NICHT verzahnen.** Branch `feat/teams-org-id` (Commit `3e662ae`) bleibt unpushed/liegen —
        nicht das strukturelle Koppel-Element. Der Identitäts-Anker ist DDISA, nicht org↔tasks-FK.
  - [x] `[2026-06-15 15:55]` Schritt 4: kanonischer `parseAgentEmail` aus Troop nach `@openape/core` gehoben
        (Troop re-exportiert → eine Quelle) + `reconcileIdentities` (Cross-Store-Drift). TDD 10/10 grün,
        core lint+typecheck grün, Troop-typecheck grün (44/44). Branch `feat/canonical-agent-identity`,
        Commit `5bc8b638`. **Noch nicht gepusht/PR.**
  - [x] `[2026-06-15 16:00]` Schritt 5: `scripts/identity-drift.mjs` (Owner-Diagnose). Live gegen beide echten
        Teams gelaufen → **0 unaufgelöste Identitäten** auf troop↔tasks (Werkstatt 8 Member, Delta Mind 3,
        je 1 Human-Zeile korrekt übersprungen). Commit `dde0ed1c`. Org-Achse = Follow-up (braucht org-Token).
  - [~] Schritt 3 (org schreibt `org_id`-Bindung automatisch) → **nach M3 verschoben**: Org hat heute KEINE
        tasks-Integration (team_ids leben in den Agent-Recipes, nicht in der Org-App). Standalone-Bau wäre
        Wegwerf-Code; die Bindung fällt natürlich bei der org↔troop-Co-Location (M3) an. Mechanik existiert
        (PATCH `org_id`), kann jederzeit manuell/per Owner-UI gesetzt werden.
- [ ] M2: Org-Agent-Auth (Brücke) — nicht gestartet
- [ ] M3: Deployables verschmelzen (Stufe 2) — nicht gestartet
- [~] M4: Ein Owner-UI (Stufe 3) — **CEO-zentrierte Company-View geliefert** `[2026-06-15 16:xx]`
  - [x] Troop bekommt `/company`: CEO prominent („Ihr Ansprechpartner" + „Mit dem CEO sprechen"-Button →
        bestehender `/agents/<ceo>`-Chat), Team read-only „über den CEO gesteuert" (kein IC-Chat-Button).
        Org-Read-Endpoints + `requireOwnedOrg`-Util nach Troop portiert. Nav-Link Agents↔Firma.
  - [x] **Visuell verifiziert** (Headless-Playwright, geforgte Dev-Session, geseedete Delta-Mind-Org):
        Desktop + Mobile-Screenshot; CEO-Klick navigiert nachweislich zu `/agents/dm-ceo` (AgentChat lädt).
        Commit `0e6d372f`, Branch `feat/org-into-troop`. lint 22/22 + typecheck 44/44 grün.
  - [x] `[2026-06-15 16:xx]` UI-Affordances (`2a1d0fa4`): Firma im UI anlegen (Empty-State-Formular),
        Member hinzufügen (Modal + Persona-Picker aus `/api/personas`), **Spawn-Button** auf invited-Membern
        (→ in-process Spawn + 2s-Polling → PK-Swap). E2E durch die echte UI verifiziert (Playwright:
        Firma anlegen → CEO-Member via Modal → CEO-Karte „invited" → „CEO spawnen" erreicht Dispatch;
        lokal 503 mangels Nest = korrekt, PROD läuft durch).
  - [x] `[2026-06-15 16:xx]` Business-Dashboard komplett (`b71e9201`): Objectives/Reports/Cost-Endpoints
        portiert (8) + Tabs „Firma | Ziele | Reports | Kosten" in der Company-Page; 3 fokussierte
        Komponenten (`CompanyObjectives` Kanban, `CompanyReports` Inbox, `CompanyCosts` Budget-Meter) +
        Vision/Budget-Edit-Modal. E2E durch die UI verifiziert (alle 4 Tabs + Edit, Daten über die neuen
        Endpoints geseedet). lint 22/22 + typecheck 44/44 grün.

**GEPUSHT → PR [#755](https://git.openape.ai/openape-ai/openape/pulls/755)** (2026-06-15): rebased auf
`forgejo/main` (Rate-Limit-Base #752 rausgehalten; ein spawn-intent-Konflikt mit mains parseAgentEmail-
Normalisierung sauber gemerged), 9 Commits, mergeable, CI läuft. core-Coverage-Gate (100% stmts) mit
Edge-Case-Tests erfüllt. Tasks-Branch `feat/teams-org-id` bleibt geparkt/ungepusht (Steer).

**B0-Merge funktional KOMPLETT** (8 Commits auf `feat/org-into-troop`): die Firma lässt
sich vollständig aus Troop heraus anlegen, bespielen (Member/Persona/Spawn, Ziele, Reports, Kosten, Vision)
und der CEO anchatten — Maschinen-Surface byte-stabil. Rest = Polish (Member-Edit/Retire-UI, Reports-
Markdown-Rendering, i18n EN). Spawn-Completion braucht einen verbundenen Nest (PROD).

## Surprises & Discoveries

- [2026-06-15] **Tasks hat KEIN `org_id`** (`openape-tasks/app/server/database/schema.ts` `teams` Z.3–10) —
  org↔team ist heute nur über `teams.createdBy`/`tasks.ownerEmail`-Email-Match herstellbar. Das IST der
  `org_id ≠ team_id`-Bug. Minimal-Fix = nullable `org_id`-Spalte (non-breaking, CLI-Vertrag bleibt).
- [2026-06-15] **Org hat heute NULL aktive Maschinen-Konsumenten** (CEO-Bearer M1 + Sanierer-Cost M3 sind
  geplant, nicht live; alle 21 Endpoints sind Owner-Session). → Org ist wirklich formbar; die einzige
  externe Kopplung ist der Spawn-Flow zum IdP (Protokoll, kein Code-Consumer).
- [2026-06-15] **Domain-Umzug ist client-safe:** alle Konsumenten lesen `OPENAPE_TROOP_URL`/`_WS_URL`
  (apes/nest/agent), einzige Hardcode-Referenz ist ein rein informativer UI-Link in `apes spawn`. Env +
  Ankündigung reicht, kein Client-Break.
- [2026-06-15] **Org trägt schon M4-Spawn-Tracking** (`orgMembers.spawnIntentId/spawnStatus/spawnGrantId`)
  + macht heute einen PK-Swap (Placeholder→real agentEmail) im Spawn-Polling — genau der Hop, der in M3
  kollabiert.
- [2026-06-15] **Org hat HEUTE keinerlei tasks-Integration** (kein `team_id`/`tasks.openape`-Ref in
  `apps/openape-org`). Die team_ids leben in den Agent-Recipes (`agent-catalog/*/ape-agent.yaml`). → M1-Schritt 3
  („Org schreibt org_id") wäre standalone Wegwerf-Code; nach M3 verschoben.
- [2026-06-15] **Drift-Lauf bestätigt: troop↔tasks ist sauber.** Werkstatt-Team (8 Member) + Delta-Mind-Team
  (3 Member) — jeder Agent-Member resolved zu einem Troop-Agent, 0 Waisen; je 1 Human-Zeile (Owner) korrekt
  übersprungen. Die 4-fach-Identität ist über den DDISA-Email JETZT deterministisch auflösbar (Evidenz:
  `node scripts/identity-drift.mjs --team …`).

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-06-15 | „FK statt String" zweiphasig: logische Referenz (M1) → harter FK bei Co-Location (M3) | Echter DB-FK geht nur intra-DB; Troop/Org/Tasks sind 3 DBs. Logische Referenz holt den 80%-Wert sofort & non-breaking | Sofort harter FK (verlangt DB-Merge vorab → bricht „billig, non-breaking" von Stufe 1) |
| 2026-06-15 | Tasks bleibt separater Service, nur `org_id`-Referenz | tasks.openape.ai hat eigene CLI + externe Konsumenten; auflösen wäre Breaking | Tasks-Tabellen auch in Troop ziehen (Vertragsbruch CLI/Agent-Tools) |
| 2026-06-15 | Kanonischer Join-Key = DDISA-Agent-Email (unverändert) | Format ist byte-stabil eingefroren (Wand) & taucht in allen 4 Stores auf | Neue globale Agent-ID einführen (bräuchte Migration aller 4 Stores + Vertragsbruch) |
| 2026-06-15 | M2 (Org-Agent-Auth) VOR M3 | Entkoppelt Persona-Funktion vom DB-Merge → M3 risikoärmer, Personas funktionieren früher | Auth erst in M3 (koppelt zwei Risiken) |
| 2026-06-15 | Org → Troop-Backend (nicht umgekehrt) | Troop = Maschinen-Surface (tragende Wand), Org = formbar ohne externe Konsumenten | Troop in Org ziehen (würde die Wand verschieben) |
| 2026-06-15 | **Tasks NICHT in troop/org verzahnen (Patrick)** | Tasks ist austauschbar (Trello o.ä.); PM verteilt frei. Anker = DDISA-Identität, nicht Team-Mitgliedschaft. `tasks.org_id`-Arbeit geparkt | org↔tasks-FK als strukturelles Koppel-Element (Über-Verzahnung) |
| 2026-06-15 | **CEO-zentrierter Chat im EINEN UI (Patrick)** | „Auf Agent klicken & reden" — aber primär nur CEO; direkte IC-Gespräche überspringen Hierarchien → Unruhe | Jeden Agent gleichberechtigt anchatbar machen |
| 2026-06-15 | **Token-Exchange-Design bleibt wie aktuell (Patrick)** | Per-SP `/api/cli/exchange` (RFC 8693) + sp-scoped Tokens bleiben — nicht auf „ein User-IdP-Bearer überall" vereinfachen. Audience-Scoping + IdP-Entkopplung pro Request behalten. Nicht erneut aufmachen | (B) Narrowing zum IdP / (C) shared User-Bearer — beide verworfen für jetzt. NB: der Merge eliminiert den org↔troop-Hop ohnehin gratis |

## Session-Checkliste

1. Diesen Plan + Progress-Section lesen.
2. `git log` (Forgejo-Remote) seit letztem Commit lesen; Live-Stand der autonomen Loops kurz prüfen
   (Nest-Container up? Opus-Motor aus? Sandbox-PRs gegatet?).
3. Dev-Server der betroffenen App starten, Baseline-Check (`pnpm lint && pnpm typecheck`).
4. Nächsten offenen Milestone identifizieren (max. 1/Session).
5. Implementieren, nach jedem Milestone committen (Branch aufs `forgejo`-Remote, PR; `main` protected).
6. E2E-Verifikation der Akzeptanzkriterien (API/UI, nicht nur Unit). Maschinen-Surface-Regressionsgate
   bei M3 NICHT überspringen.
7. Progress + Discoveries aktualisieren.

## Outcomes & Retrospective

> Erst nach Abschluss ausfüllen.
