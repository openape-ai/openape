# Plan: troop Memory (+ Skills als Phase 2)

> Self-contained. Ein Agent/Mensch ohne Vorwissen kann diesen Plan top-down umsetzen.

## Nomenklatur (an Claude-Konzepte angelehnt)

Bewusste Entscheidung (2026-07-15): troop übernimmt Claudes interne Primitive-Namen — erhöht Verständnis
+ Akzeptanz bei Stakeholdern, weil das Mentalmodell schon bekannt ist.

| troop-Konzept | = Claude-Konzept | Bedeutung |
|---|---|---|
| **Memory** | Memory / CLAUDE.md | Persistente, nachschlagbare Fakten/Referenz, scoped auf company/agent |
| **Skill** | Skill | Benannte, beschriebene Prozedur (name + description + prompt), description-selektiert |
| **Agent** | Agent/Subagent | Ein Mitarbeiter = Rolle + Tools + Persona (im Firmen-UI weiter „Mitarbeiter"/„CEO") |

Frühere Arbeitsnamen: „Knowledge" → **Memory**, „Workflow" → **Skill**.

## Purpose / Big Picture

- **Ziel:** troop-Agents (CEO + Rollen) bekommen **Memory** — nachschlagbare Fakten/Referenz, scoped auf
  `company` / `role` / `agent`. Der Owner pflegt z.B. „so ist die Datenablage strukturiert", Kontakte,
  Naming-Konventionen — und der passende Agent *weiß* es beim Arbeiten, statt zu raten.
- **Kontext:** Live-Bedarf bewiesen (2026-07-14/15): der CEO konnte die Lohnverrechnung erst korrekt ablegen,
  als er auf `~/.claude/commands/buchhaltung.md` gezeigt bekam (via lokalem `cockpit-extra.txt`-Hack). Memory
  macht daraus ein erstklassiges troop-Konzept — eine Quelle, für alle Maschinen, nicht nur Patricks File.
- **Scope drin:** `memory`-Tabelle, Injection in den CEO-Prompt (inline + referenziert/fetchbar), Scoping
  company/role/agent, Fetch-Endpoint für große Docs, troop-UI zum Pflegen.
- **Scope raus (Phase 2, Block unten):** Skills (= benannte Prozeduren, technisch ≈ Claude-Skills). Erst
  Memory, weil ein Skill Memory referenziert.

**Architektur-Anker (Decision):** troop bildet die bewährten Claude-Primitive für die „Firma"-Abstraktion
nach: **Memory ≈ CLAUDE.md/Memory**, **Skill ≈ Skill**, **Agent ≈ Agent/Subagent**. Diese Mapping-Treue ist
die Design-Leitplanke UND die Stakeholder-freundliche Nomenklatur.

## Repo-Orientierung

- **Projekt:** `apps/openape-troop` (Nuxt 4 / Nitro / Drizzle+LibSQL), Monorepo
  `~/Companies/private/repos/openape/openape-monorepo`.
- **Relevante Dateien:**
  - `server/database/schema.ts` — `organizations` (Z.280: `vars` JSON = company-Fakten),
    `cockpitAgents` (Z.397: `role`/`label`/`duties`/`procedure`/`vars`). **Neue Tabelle `memory` hier.**
  - `server/utils/cockpit/system-prompt.ts` — `buildSystemPrompt(org, objs, owner, team)`. **Memory-Injection
    hier** (neuer Param).
  - `server/api/cockpit/message.post.ts` — lädt org/objectives/agents, ruft `buildSystemPrompt`, enqueued
    (Z.26-39). **Hier Memory laden + durchreichen.**
  - `server/plugins/02.database.ts` — idempotente `CREATE TABLE IF NOT EXISTS`-Migrationen (Muster).
  - `server/api/cockpit/agent/tasks/next.post.ts` + `public/worker/cockpit-agent.sh` — headless Worker holt
    Tasks; für Referenz-Memory braucht er einen Fetch-Weg.
  - UI: `app/pages/companies/`, `app/pages/agents/`, `app/pages/company/` — Memory-Editor.
  - **Worker-Seite (heute):** `~/.config/openape-worker/worker.sh` hängt `cockpit-extra.txt` an den Cockpit-
    Prompt (lokaler Vorläufer von Memory; wird durch troop-Memory abgelöst, bleibt als lokaler Override).
- **Tech-Stack:** h3/Nitro, Drizzle ORM, Vue 3 `<script setup>`, @nuxt/ui.
- **Dev-Setup:** `pnpm --filter @openape/troop dev`; DB = LibSQL-File in `shared/`. Prod-DB auf chatty:
  `/home/openape/projects/openape-troop/shared/openape-troop.db`. Checks:
  `pnpm turbo run lint typecheck --filter=@openape/troop`.

## Milestones

### Milestone 1: `memory`-Tabelle + company-scoped inline-Injection

**Ziel:** Ein company-weites Memory-Doc landet automatisch im CEO-Prompt; der CEO nutzt es.

**Schritte:**
1. `schema.ts`: Tabelle `memory`: `id` (pk), `ownerEmail`, `orgId`, `scope` ('company'|'role'|'agent'),
   `targetId` (Rolle-String bzw. agent-id; leer bei company), `title`, `body`, `mode` ('inline'|'reference',
   default 'inline'), `createdAt`, `updatedAt`. Index `(orgId, scope)`.
2. `server/plugins/02.database.ts`: `CREATE TABLE IF NOT EXISTS memory …` + Index (idempotent).
3. `system-prompt.ts`: `buildSystemPrompt` bekommt Param `memory: {title,body,mode}[]`. Für `mode==='inline'`
   ans Ende: `\n\n--- Memory (${title}) ---\n${body}`.
4. `message.post.ts`: company-Memory laden (`orgId=company AND scope='company'`) und durchreichen.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run typecheck lint --filter=@openape/troop` → grün.
- [ ] DB-Insert (`scope='company'`, `body='Der Geheimcode ist BANANE42.'`) → Chat „Was ist der Geheimcode?"
      → CEO: „BANANE42". Ohne Doc → CEO weiß es nicht.

**Rollback:** Tabelle bleibt leer = kein Effekt; `buildSystemPrompt`-Param optional/default `[]`.

### Milestone 2: Referenz-Docs + Fetch-Endpoint (großes Memory on-demand)

**Ziel:** Große Docs blähen den Prompt nicht — Index im Prompt, Agent holt sie bei Bedarf. Löst den
`buchhaltung.md`-Fall sauber in troop.

**Schritte:**
1. `buildSystemPrompt`: für `mode==='reference'` nur Index-Zeile:
   `Verfügbares Memory (bei Bedarf: \`cockpit-agent.sh memory <id>\`): ${title} [${id}]`.
2. Endpoint `server/api/cockpit/agent/memory/[id].get.ts` — auth `requireCockpitAgent`, liefert `body` wenn
   Doc zur org des Agents gehört.
3. `public/worker/cockpit-agent.sh`: Subcommand `memory <id>` → GET auf den Endpoint → Body ausgeben.
4. `worker.sh` COCKPIT_DIRECTIVE: Hinweis „referenziertes Memory: `bash "$CA" memory <id>`".

**Akzeptanzkriterien:**
- [ ] `mode='reference'`-Doc → Prompt enthält nur die Index-Zeile (Prompt-Länge klein).
- [ ] `bash cockpit-agent.sh memory <id>` → Body (HTTP 200).
- [ ] Chat-Aufgabe, die's braucht → im Stream taucht `memory <id>` auf, Antwort geerdet im Doc.

**Rollback:** Endpoint + Subcommand entfernen; Docs auf `inline`.

### Milestone 3: Scoping role/agent + Zugriff für delegierte Blätter

**Ziel:** Memory, das nur die Buchhaltung braucht, geht nur an die Buchhaltung.

**Schritte:**
1. `message.post.ts`: neben company- auch CEO-role-Memory laden.
2. Delegation: role/agent-Memory für delegierte Blätter (prüfen wie der Subagent-Prompt heute entsteht —
   evtl. reicht Index im CEO-Prompt + Fetch, da das Blatt dieselbe Agent-Auth nutzt).
3. Fetch-Endpoint (M2): Scope-Check — Agent zieht nur Docs seiner org (später seiner Rolle).

**Akzeptanzkriterien:**
- [ ] `scope='role', targetId='buchhaltung'`-Doc erscheint im CEO-Index bei Buchhaltungs-Themen, nicht im
      allgemeinen Chat.
- [ ] Agent kann kein Doc einer fremden org ziehen (403).

**Rollback:** Scope-Filter auf `company` beschränken.

### Milestone 4: troop-UI — Memory pflegen

**Ziel:** Owner legt Memory in der troop-Oberfläche an/ändert, ohne SQL.

**Schritte:**
1. API-CRUD: `server/api/cockpit/orgs/[orgId]/memory` (GET/POST) + `…/memory/[id]` (PATCH/DELETE),
   owner-gated.
2. UI: Company-Seite (`app/pages/company/`) „Memory"-Panel (Liste + Editor: title, body, scope, mode;
   role/agent-Auswahl bei entsprechendem Scope).

**Akzeptanzkriterien:**
- [ ] In troop Memory anlegen → in Liste → CEO nutzt es im Chat (E2E). Bearbeiten/Löschen ok.

**Rollback:** UI-Panel ausblenden; API bleibt.

## Phase 2 (später, eigener Plan): Skills

> Technisch ≈ Claude-Skills. **Erst nach Memory**, da ein Skill Memory referenziert.

- Tabelle `skills(orgId, name, description, prompt, preferredRole?)`.
- **Auswahl wie Claude-Skills:** der CEO wählt den passenden Skill über die `description` (gleiche Mechanik
  wie Skill-Selektion), oder der Owner triggert per Name, oder per Schedule.
- **Ausführung:** Skill → Task mit dem Skill-`prompt` + Kontext des ausführenden Agents (+ dessen Memory).
  `preferredRole` steuert den Ausführer.
- **Abgrenzung (Decision):** Ein Skill ist KEIN Agent. Agent = Akteur; Skill = Arbeitseinheit, die ein Akteur
  ausführt.
- **Offene Idee:** troop-Skills könnten optional auf echte Claude-Code-Skills/Commands der Worker-Maschine
  mappen (wie heute `buchhaltung.md`) — Hybrid aus troop-verwaltet und maschinen-lokal.

## Progress

- [x] `[2026-07-15 10:45]` Plan erstellt + Nomenklatur (Memory/Skill) übernommen. Freigabe ausstehend.
- [x] `[2026-07-15 10:30]` Offene Fragen von Patrick beantwortet: (1) Memory in troop, API existiert, **kein**
      Import; (2) ~1500-Schwelle als Default, nicht hart; (3) **M3** voll (role/agent inkl. delegierte Blätter).
- [x] `[2026-07-15 10:30]` **Milestone 1 umgesetzt** (Branch `feat/troop-memory`): `memory`-Tabelle (schema.ts
      + idempotente Migration in 02.database.ts), `buildSystemPrompt(…, memory[])` mit inline-Injection +
      reference-Index-Zeile, `message.post.ts` lädt company-scoped Memory. Unit-Tests grün (inline body +
      reference index-line), lint+typecheck grün, Migrations-SQL gegen SQLite validiert (Insert/Index ok).
      **Offen:** Live-Chat-E2E (BANANE42) braucht troop-Deploy — nach Freigabe (Deploy killt Cockpit-Queue).

## Surprises & Discoveries

- [2026-07-15] `cockpitAgents` hat bereits `procedure` (Rollen-Arbeitsanweisung) + `vars`; `organizations`
  hat `vars`. Teil-Vorläufer — Memory ist die neue, explizit nachschlagbare Referenz-Dimension.
- [2026-07-15] Der `buchhaltung.md`-Fall: EIN Doc war Prozedur UND Memory zugleich → verschmelzen in Praxis,
  konzeptionell trennbar (Skill referenziert Memory).

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-07-15 | Nomenklatur = Claude-Konzepte (Memory/Skill/Agent) | Stakeholder-Verständnis + Akzeptanz; bekanntes Mentalmodell | eigene Begriffe (Knowledge/Workflow) |
| 2026-07-15 | Memory zuerst, Skills Phase 2 | Bedarf akut bewiesen; Skills bauen auf Memory auf | beides parallel |
| 2026-07-15 | Skill ≠ Agent | Akteur vs. Arbeitseinheit | Skill als Agent-Typ |
| 2026-07-15 | inline vs reference | klein inline, groß referenziert+fetchbar → kein Prompt-Bloat | alles inline |

## Session-Checkliste

1. Plan lesen, Progress prüfen.
2. Baseline: `pnpm turbo run typecheck lint --filter=@openape/troop` grün?
3. Milestone umsetzen (max. 1/Session), Akzeptanzkriterien beweisen.
4. Progress/Discoveries/Decisions aktualisieren.
5. Bei DB-Änderungen: idempotente Migration in `02.database.ts` + auf Prod-DB (chatty) mitziehen.

## Offene Fragen (vor Milestone 1 klären)

- **Authoring:** Memory nur in troop-UI, oder auch aus lokalen Files importierbar (buchhaltung.md → troop)?
  Tendenz: troop = Quelle, mit optionalem Import.
- **Größen-Schwelle:** ab welcher Body-Länge automatisch `reference` statt `inline`? Vorschlag ~1500 Zeichen.
- **Delegation:** role-Memory schon in M1/M3 an delegierte Blätter, oder vorerst CEO + Fetch-Endpoint?
