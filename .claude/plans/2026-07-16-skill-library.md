# Plan: Globale Skill-Bibliothek (owner-level) + Tool-Skills

> Self-contained. Baut auf dem Skills-Feature (org-scoped, PR #959) auf. Ziel: Tooling raus aus
> `worker.sh`/Memory, rein in wiederverwendbare, firmenübergreifend zuweisbare **Tool-Skills**.

## Purpose / Big Picture

- **Problem:** die worker.sh-Direktive und das Firmen-Memory tragen aktuell Tooling-Wissen (welches Mail-
  CLI, wie man es bedient). Das ist maschinen-/firmenspezifisch und skaliert nicht — verschiedene Leute
  haben verschiedenes Tooling.
- **Lösung:** ein **Tool-Skill** pro Werkzeug (`o365-cli`, `gmail-cli`, …), einmal owner-weit definiert,
  an Agents beliebiger Firmen zuweisbar. Sauberer Schnitt:
  - **Policy** (Trust-Boundary) → bleibt in der Direktive (tool-**un**abhängig).
  - **Tooling** (WIE man o365-cli/gmail-cli bedient) → **Tool-Skill** (Bibliothek).
  - **Config** (WELCHES Konto, WELCHE Pfade) → Firmen-Memory.
- **Entscheidung (Patrick, 2026-07-16):** globale, wiederverwendbare Bibliothek (owner-level), NICHT
  org-scoped-Duplikate und NICHT nur ein Seed-Katalog.

## Architektur-Anker

- **Kern-Trick (kein neues Table):** `cockpit_skills.orgId = ''` (leer) = **Bibliotheks-Skill**, nur
  `ownerEmail`-scoped, firmenübergreifend. `orgId != ''` = wie bisher org-scoped.
- **Zuweisung reused:** `assignedTo` hält cockpit_agent-**ids** (global eindeutige UUIDs) + `'ceo'`. Ein
  Bibliotheks-Skill listet Agent-ids aus BELIEBIGEN Firmen. Kein Cross-Org-Sonderfall.
- **Surfacing:** `message.post` lädt für Firma X: org-Skills von X **+** Bibliotheks-Skills, deren
  `assignedTo` einen Agent von X (oder `'ceo'`) trifft. Beim Durchreichen an `buildSystemPrompt` wird
  `assignedTo` auf die Ziele von X **gefiltert** (kein fremder-Firma-UUID-Leak in den Prompt).

## Repo-Orientierung

- `apps/openape-troop/server/database/schema.ts` — `cockpitSkills` (orgId text). **Kein Schema-Change**,
  nur die Semantik `orgId=''`.
- `apps/openape-troop/server/api/cockpit/message.post.ts` — lädt org-Skills (`eq(orgId, company)`).
  **Hier Bibliotheks-Skills dazuladen + assignedTo filtern.**
- `apps/openape-troop/server/utils/cockpit/system-prompt.ts` — `buildSystemPrompt(… skills)` surfacet
  Skills (getaggt). Bleibt unverändert (bekommt schon gefilterte skills).
- `apps/openape-troop/server/api/cockpit/orgs/[orgId]/skills(.get|.post).ts` + `skills/[id].(patch|delete).ts`
  — org-scoped CRUD (Vorbild für die owner-level Klone).
- `apps/openape-troop/server/utils/cockpit/skill-assign.ts` — `validateAssignedTo(owner, orgId, raw)`
  prüft gegen EINE org. **Owner-level Variante: gegen ALLE Agents des Owners.**
- `apps/openape-troop/app/components/company/Skills.vue` — org-Panel (Vorbild fürs Bibliotheks-UI).
- `public/worker/worker.sh` COCKPIT_DIRECTIVE — trägt noch Tool-Reste (WERKZEUGE-Beispiel). **M4: raus.**
- Checks: `pnpm turbo run lint typecheck --filter=@openape/troop`; `pnpm --filter @openape/troop test`;
  `build`.

## Milestones

### Milestone 1: Bibliotheks-Skills (`orgId=''`) laden + surfacen

**Ziel:** Ein Bibliotheks-Skill, einem Agent von Firma X zugewiesen, erscheint im Operator-Prompt von X.

**Schritte:**
1. `skill-assign.ts`: neue `validateOwnerAssignedTo(owner, raw)` — jeder Eintrag ist `'ceo'` oder eine
   cockpit_agent-id, die dem Owner gehört (über ALLE orgs). (org-scoped `validateAssignedTo` bleibt.)
2. `message.post.ts`: nach den org-Skills auch Bibliotheks-Skills laden
   (`ownerEmail=owner AND orgId=''`). Filtern: behalte einen, wenn `assignedTo` `'ceo'` enthält ODER
   eine id aus `teamRows` (Firma X). Vor dem Durchreichen `assignedTo` auf `['ceo', …X-ids]` reduzieren.
   org-Skills + gefilterte Bibliotheks-Skills zusammen an `buildSystemPrompt`.

**Akzeptanzkriterien:**
- [ ] `typecheck lint test` grün; Unit-Test: ein Bibliotheks-Skill (orgId='', assignedTo=[agentX]) wird für
      Firma X gesurfacet, für Firma Y NICHT; fremde assignedTo-ids landen nicht im X-Prompt.
- [ ] Dev-Smoke: Bibliotheks-Skill per SQL (orgId='') + Zuweisung an einen Agent → erscheint im Prompt.

**Rollback:** Bibliotheks-Load-Zweig entfernen; nur org-Skills.

### Milestone 2: Owner-level CRUD-API

**Ziel:** Bibliothek per API pflegen (ohne orgId).

**Schritte:**
1. `server/api/cockpit/skills.get.ts` (Liste: `ownerEmail=owner AND orgId=''`) + `skills.post.ts`
   (anlegen mit `orgId=''`, `validateOwnerAssignedTo`).
2. `server/api/cockpit/skills/[id].patch.ts` + `[id].delete.ts` (owner-gated, `orgId=''`).
3. Auth: `cockpitOwner` statt `requireOwnedOrg`.

**Akzeptanzkriterien:**
- [ ] Dev-Smoke: POST Bibliotheks-Skill, list, PATCH (assignedTo über 2 Firmen), DELETE — alles per curl.
      assignedTo mit fremd-Owner-Agent → 400.

**Rollback:** Endpoints entfernen; Bibliothek per SQL pflegbar.

### Milestone 3: UI — Skill-Bibliothek

**Ziel:** Owner pflegt die Bibliothek + weist firmenübergreifend zu, ohne SQL.

**Schritte:**
1. Seite `app/pages/skills/index.vue` (owner-level, aus dem Companies-Nav erreichbar): Liste + Editor
   (name, description, prompt, Zuweisung). Klon von `Skills.vue`.
2. Zuweisungs-UI: Checkbox-Liste ALLER Agents des Owners, **gruppiert nach Firma** (Agents via
   `/api/cockpit/orgs` + je `…/agents`, oder ein neuer `/api/cockpit/agents`-Sammelendpoint).

**Akzeptanzkriterien:**
- [ ] In der UI Bibliotheks-Skill anlegen, einem Agent in Firma A + einem in Firma B zuweisen → beide
      Operatoren sehen ihn (E2E nach Deploy). Bearbeiten/Löschen ok.

**Rollback:** Seite ausblenden; API bleibt.

### Milestone 4: Tool-Skills seeden + Tooling aus Direktive/Memory ziehen

**Ziel:** Der Ist-Zwischenstand (Tooling in worker.sh/Memory) wird abgelöst.

**Schritte:**
1. Bibliotheks-Skills anlegen:
   - `o365-cli` (description „Microsoft 365 Mail & Kalender via o365-cli"; prompt = Kommandos: mail
     search/read/attachments/archive-from/move, calendar create/update; Konto kommt aus dem Memory).
   - `gmail-cli` (description „Gmail via gmail-cli"; prompt = mail list/read/search/send/reply/archive/move,
     KEIN Kalender; Konto aus Memory).
2. Zuweisen: `o365-cli` → Delta-Mind- + IURIO-Mail-Assistent; `gmail-cli` → privat-Mail-Assistent.
3. `worker.sh` COCKPIT_DIRECTIVE WERKZEUGE: kein Tool-Beispiel mehr → „nutze die dir zugewiesenen Skills
   fürs Tooling (dort steht CLI + Bedienung); Konto/Pfade aus dem Memory". Sync (3 Orte) + Worker-Neustart.
4. Firmen-Memory auf **Config-only** trimmen (Konto + Pfade), CLI-Bedien-Prosa raus (steht jetzt im Skill).

**Akzeptanzkriterien:**
- [ ] E2E: DM-Operator nutzt weiter o365-cli/phofmann@delta-mind.at, privat-Operator gmail-cli/hofmann.eco
      — jetzt geerdet im zugewiesenen Tool-Skill, nicht in der Direktive. worker.sh nennt kein Tool mehr.

**Rollback:** Direktive/Memory-Stand vor M4 wiederherstellen (git + Memory-PATCH).

## Verifikations-Reihenfolge

lint → typecheck → test → build → Dev-Smoke (Wegwerf-DB) → nach Merge Worker-Sync/Neustart + prod-E2E.
worker.sh-Änderung ist worker-only (kein troop-Deploy); die UI (M3) braucht troop-Deploy.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-07-16 | Globale Bibliothek (owner-level, `orgId=''`) | „ein Set an Skills", wiederverwendbar; kein neues Table | org-scoped-Duplikate; Seed-Katalog; neues library-Table |
| 2026-07-16 | Zuweisung via `assignedTo` (globale Agent-UUIDs) | ids sind schon global eindeutig; kein Cross-Org-Sonderfall | join-Table org↔skill |
| 2026-07-16 | Policy bleibt in Direktive, Tooling in Skills, Config in Memory | saubere Trennung; Direktive tool-agnostisch | alles in Skills; alles in Memory |

## Progress

- [ ] `[2026-07-16]` Plan erstellt nach Brainstorming (Scope-Frage: globale Bibliothek gewählt). Freigabe erteilt.

## Offene Fragen

- Keine blockierenden. `/api/cockpit/agents`-Sammelendpoint (M3) vs. N Einzel-Calls: Umsetzungsdetail, im
  Milestone entscheiden.
