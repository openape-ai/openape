# Plan: troop Skills (Phase 2, baut auf Memory auf)

> Self-contained. Ein Agent/Mensch ohne Vorwissen kann diesen Plan top-down umsetzen. Voraussetzung:
> troop **Memory** (PR #957) ist gemerged+deployed — Skills wiederverwenden dessen Infrastruktur 1:1.

## Nomenklatur (an Claude-Konzepte angelehnt)

| troop-Konzept | = Claude-Konzept | Bedeutung |
|---|---|---|
| **Memory** | Memory / CLAUDE.md | Persistente, nachschlagbare Fakten/Referenz (schon gebaut) |
| **Skill** | Skill | Benannte, per `description` auffindbare **Prozedur** (name+description+prompt), einem Agent zugeordnet |
| **Agent** | Agent/Subagent | Ein Mitarbeiter = Rolle + Tools + Persona |

## Purpose / Big Picture

- **Ziel:** Ein **Skill** ist eine wiederverwendbare, benannte Arbeitseinheit (name + description + prompt). Er
  wird einem oder mehreren **Agents zugeordnet** (CEO und/oder Delegations-Blätter). Ein zugeordneter Agent
  entscheidet **autonom per `description`-Match** (genau wie Claude Skills wählt), wann er ihn einsetzt, holt
  bei Bedarf den `prompt` und **befolgt ihn inline in seinem eigenen Turn** — keine Extra-Prozesse.
- **Abgrenzung zu `procedure`** (Decision, Patrick 2026-07-15): `cockpitAgents.procedure` bleibt die
  **rollen-fest** angeklebte Arbeitsanweisung. Ein Skill ist davon **entkoppelt**: einmal definiert,
  wiederverwendbar, per Zuordnung an beliebige Agents gebunden. Kein Ersatz von `procedure`, ein Konzept daneben.
- **Abgrenzung zu Memory:** Memory = Fakten, die ein Agent *weiß* (Daten). Skill = Prozedur, die ein Agent
  *ausführt* (Anweisung). Gleiche technische Infrastruktur (Index-Zeile + Fetch), semantisch getrennt.

**Architektur-Anker (Decision):** Skill-Ausführung = **inline load-and-follow** (Claude-Skill-Modell), NICHT
eine isolierte Sub-Task. Wiederverwendet exakt das Memory-`reference`-Muster: Index-Zeilen im Prompt →
Agent holt den Body per Fetch → befolgt ihn.

## Repo-Orientierung

- **Projekt:** `apps/openape-troop` (Nuxt 4 / Nitro / Drizzle+LibSQL).
- **Vorbild = die Memory-Implementierung** (alles hier ist ein Klon davon):
  - `server/database/schema.ts` — Tabelle `memory` (~Z.393). **Neue Tabelle `cockpitSkills` daneben.**
    ⚠️ NICHT das bestehende `agent_skills` (Maschinen-Agent-Recipes, anderer Layer) wiederverwenden.
  - `server/plugins/02.database.ts` — idempotente `CREATE TABLE IF NOT EXISTS memory`. **`cockpit_skills` analog.**
  - `server/utils/cockpit/system-prompt.ts` — `buildSystemPrompt(org, objs, owner, team, memory)`. **Param
    `skills` ergänzen**, Surfacing analog zu Memory-Index (getaggt nach Ziel).
  - `server/api/cockpit/message.post.ts` — lädt `memory` per org. **`cockpit_skills` analog laden + durchreichen.**
  - `server/api/cockpit/agent/memory/[id].get.ts` — owner-bound Fetch. **`agent/skill/[id].get.ts` = Klon.**
  - `server/api/cockpit/orgs/[orgId]/memory(.get|.post).ts` + `memory/[id].(patch|delete).ts` — owner-gated CRUD.
    **`…/skills…` = Klon** (mit `assignedTo` statt `mode`).
  - `public/worker/cockpit-agent.sh` — Subcommand `memory <id>`. **`skill <id>` analog.**
  - `public/worker/worker.sh` — `MEMORY:`-Hinweis in `COCKPIT_DIRECTIVE`. **`SKILLS:`-Hinweis analog.**
  - `app/components/company/Memory.vue` + Tab in `app/pages/companies/[id].vue`. **`Skills.vue` = Klon** (Zuordnungs-
    Auswahl statt mode-Select).
- **Checks:** `pnpm turbo run lint typecheck --filter=@openape/troop`; Tests `pnpm --filter @openape/troop test`;
  Build `pnpm turbo run build --filter=@openape/troop`.
- **Worker-Assets an 3 Orten synchron halten:** repo `apps/openape-troop/public/worker/`, live
  `~/.config/openape-worker/`, Skill `~/.claude/skills/openape-worker/assets/`. worker.sh **nie blind cp-en**
  (siehe Memory-Session: gezielter Edit) — obwohl der cockpit-extra-Block inzwischen entfernt ist, bleibt der
  gezielte-Edit-Reflex richtig.

## Datenmodell

```
cockpit_skills:
  id           TEXT PK
  owner_email  TEXT
  org_id       TEXT
  name         TEXT              -- kurzer Bezeichner (z.B. "monatsbericht")
  description  TEXT              -- wofür/wann — der Agent wählt darüber (wie Claude Skills)
  prompt       TEXT              -- die Arbeitsanweisung, die der Agent befolgt
  assigned_to  TEXT (JSON [])    -- Ziele: cockpit_agent-ids und/oder 'ceo'
  created_at   INTEGER
  updated_at   INTEGER
  INDEX (org_id)
```

`assignedTo`: `['ceo']` → nur der CEO; `['<agentId>']` → nur dieses Blatt; mehrere möglich. Leer = keinem
zugeordnet (erscheint nirgends im Prompt — nur in der UI-Liste).

## Milestones

### Milestone 1: `cockpit_skills` + Surfacing im Prompt

**Ziel:** Ein einem Agent zugeordneter Skill erscheint als Index-Zeile im passenden Prompt; der Agent kann ihn
autonom wählen. (Body-Fetch kommt in M2 — ohne M2 kennt der Agent nur name+description, was zum Selektieren reicht.)

**Schritte:**
1. `schema.ts`: Tabelle `cockpitSkills` (Felder oben) + `export type Skill/NewSkill`.
2. `02.database.ts`: `CREATE TABLE IF NOT EXISTS cockpit_skills …` + Index `(org_id)` (idempotent).
3. `system-prompt.ts`: Param `skills: {id,name,description,assignedTo}[]`. Surfacing als eigener Block:
   `\n\nVerfügbare Skills (Prozeduren; bei Einsatz abrufen: \`cockpit-agent.sh skill <id>\`):` +
   pro Skill `\n- ${name}: ${description}${tag} [${id}]`, wobei `tag` = `` (ceo) `` bzw. `(für ${agentLabel})`.
   Nur Skills anzeigen, deren `assignedTo` den Empfänger trifft: im CEO-Prompt = `'ceo'`-Skills **und**
   an-Blätter-getaggte (der CEO reicht sie weiter — analog role-Memory M3).
4. `message.post.ts`: `cockpit_skills` per org laden (`orgId` + `ownerEmail`), auf `{id,name,description,assignedTo}`
   mappen, an `buildSystemPrompt` durchreichen. Für das Tagging: die Team-Labels (schon geladen) nutzen, um
   `assignedTo`-agentIds auf lesbare Labels zu mappen.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run typecheck lint --filter=@openape/troop` grün; `test` grün (neuer Unit-Test in
      `tests/cockpit-system-prompt.test.ts`: `assignedTo:['ceo']` → Index-Zeile mit `[id]` erscheint;
      leeres `assignedTo` → erscheint NICHT).
- [ ] Dev-Smoke (wie Memory): Org seeden, Skill per API anlegen (M3-CRUD noch nicht da → per SQL-Insert),
      Prompt-Injektion über den Unit-Test belegt.

**Rollback:** Tabelle leer = kein Effekt; `skills`-Param default `[]`.

### Milestone 2: Fetch-Endpoint + Worker-Subcommand

**Ziel:** Der Agent holt den `prompt` on-demand und befolgt ihn.

**Schritte:**
1. `server/api/cockpit/agent/skill/[id].get.ts` — Klon von `agent/memory/[id].get.ts`: `requireCockpitAgent`,
   owner-bound (`ownerEmail === agent`), liefert `{id,name,prompt}`; 404 wenn fremd.
2. `public/worker/cockpit-agent.sh`: Subcommand `skill <id>` (Klon von `memory <id>`) → GET → gibt `prompt` aus.
3. `public/worker/worker.sh` `COCKPIT_DIRECTIVE`: `SKILLS:`-Hinweis („Zeigt der Prompt einen Skill mit id, den du
   für die Aufgabe brauchst, hol die Anweisung mit `bash "$CA" skill <id>` und befolge sie.").
4. **Assets an alle 3 Orte** syncen (cockpit-agent.sh voll-cp ok; worker.sh gezielter Edit).

**Akzeptanzkriterien:**
- [ ] Dev-Server: `curl` auf `/api/cockpit/agent/skill/<id>` ohne Token → 401 (Route wired); mit gültigem
      Token + eigenem Skill → 200 + prompt; fremder Owner → 404.
- [ ] `bash cockpit-agent.sh skill <id>` gibt den prompt aus (gegen prod nach Deploy).

**Rollback:** Endpoint + Subcommand + Hinweis entfernen.

### Milestone 3: troop-UI — Skills pflegen + zuordnen

**Ziel:** Owner legt Skills an und ordnet sie Agents (inkl. CEO) zu — ohne SQL.

**Schritte:**
1. API-CRUD (owner-gated, Klon der Memory-CRUD): `server/api/cockpit/orgs/[orgId]/skills(.get|.post).ts` +
   `skills/[id].(patch|delete).ts`. Body: `name, description, prompt, assignedTo[]`. `assignedTo` validieren:
   jeder Eintrag ist `'ceo'` oder eine cockpit_agent-id **derselben org**.
2. UI: `app/components/company/Skills.vue` (Klon von `Memory.vue`) — Liste + Editor (name, description, prompt,
   **Zuordnungs-Checkboxen**: CEO + alle Agents der org). Tab „Skills" (`i-lucide-wand-2`) in `companies/[id].vue`.

**Akzeptanzkriterien:**
- [ ] Dev-Smoke: Skill anlegen (assignedTo `['ceo']`), listen, patchen (Zuordnung ändern), löschen — alles per
      curl belegt; fremde org → 404; ungültiges `assignedTo` → 400.
- [ ] E2E nach Deploy: Skill „sag-hallo" (prompt „Antworte genau mit: HALLO-SKILL-42") dem CEO zuordnen →
      im Cockpit eine Anfrage, die den Skill triggert → CEO gibt HALLO-SKILL-42. Danach Test-Skill löschen.

**Rollback:** UI-Tab ausblenden; API bleibt.

## Verifikations-Reihenfolge (pro Milestone)

lint → typecheck → test → build → Dev-Smoke (curl gegen Wegwerf-DB, `COCKPIT_DEV_OWNER` + geseedete Org) →
nach Merge+Deploy die E2E. **Deploy startet troop neu → Cockpit-Queue weg; nicht deployen, während Patrick
live im Chat ist.** Git/PR-Flow: Forgejo (origin), Branch `--no-verify` pushen, PR via API, Merge `{"Do":"merge"}`.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-07-15 | Skill = wiederverwendbar, per Zuordnung an Agents gebunden | Ein Skill soll von mehreren Rollen nutzbar sein; Trennung von der rollen-festen `procedure` | Skill ersetzt procedure; Skill = maschinen-lokaler Claude-Command |
| 2026-07-15 | Trigger = Agent wählt autonom per description (aus seinen zugeordneten Skills) | Spiegelt das Claude-Subagent+Skill-Modell; kein manuelles Anstoßen nötig | Owner-per-Name-Trigger; Schedule-Trigger (beide YAGNI, nachrüstbar) |
| 2026-07-15 | Ausführung = inline load-and-follow | Weniger Maschinerie, wiederverwendet Memory-Infra 1:1 | isolierte Sub-Task mit eigenem Kontext |
| 2026-07-15 | org-scoped, kein cross-company-Reuse, kein preferredRole | YAGNI; Zuordnung ersetzt preferredRole | owner-globale Skills |

## Progress

- [ ] `[2026-07-15]` Plan erstellt nach Brainstorming (4 Design-Fragen mit Patrick geklärt). Freigabe erteilt.

## Offene Fragen

- Keine. Alle Weichen (Skill-vs-procedure, Trigger, Ausführung, Scope) sind im Decision Log entschieden.
