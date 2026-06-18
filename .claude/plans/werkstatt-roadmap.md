# OpenApe Agent-Company — Vision & Roadmap

> Lebende Steuerungs-Datei für Patrick (Owner/Entscheider). Stand 2026-06-15.
> Zweck: auf Milestone-Ebene steuern statt pro Task; bei Blockaden woanders weiterarbeiten.

## Vision

Autonome Agent-Organisationen, die echte Arbeit liefern — nicht nur sich selbst entwickeln.
Patrick steuert auf **Vision + Roadmap-Ebene**; der CEO/PM übersetzt das in Arbeit; Agents
führen aus. Patrick wird nur für **gebündelte Entscheidungen** zugezogen, nie pro Task.

Zwei Orgs:
- **OpenApe Werkstatt** — baut/betreibt das DDISA-Ökosystem (Self-Development).
- **Delta Mind** — PROD-Org für echte Delta-Mind-Use-Cases (Email-Assistent, Buchhaltungs-Assistent).

## Das Steuerungs-Modell (gegen den Deadlock)

Der Deadlock dieser Session (alle Tasks auf Owner-Entscheidungen blockiert) hatte EINE Ursache:
kein geteiltes Richtungsbild + alles lief synchron über Patrick. Fix = drei Mechanismen:

1. **Vision (pro Org)** — das „Warum/Was" (org.openape.ai `visionMd`). Selten geändert.
2. **Roadmap (parallele Tracks)** — geordnete Milestones je Track. Mehrere Tracks laufen
   gleichzeitig → ist Track A auf eine Entscheidung blockiert, treibt der PM Track B/C weiter.
3. **Decision Queue (async, gebündelt)** — blockierte Items landen NICHT als Stillstand, sondern
   in einer Owner-Entscheidungs-Liste, die Patrick **gebündelt** (z.B. 1×/Tag oder im Weekly)
   abarbeitet. Der PM/CEO zieht derweil das nächste UNblockierte Item. „Blocked here → continue there."

→ Konkret heißt das: der PM-Orchestrator priorisiert immer *actionable* Arbeit, und alles
Owner-Pflichtige wird in einer klaren, gebündelten Liste gesammelt (nicht 1 Eskalation pro Tick).

## Tracks

### Track A — Agent-Execution (REFRAME 2026-06-15: läuft schon, viel einfacher als gedacht)
**KORREKTUR:** Self-Coding war nie das Problem — es LÄUFT. Die Agents (`werkstatt-backend/qa/scribe`
mit eigenen Forgejo-Identitäten seit 2026-06-13) öffnen echte autonome PRs (Beweis: werkstatt-sandbox
PR #5 von heute, „Task Brief Composer MVP for task 01KV50G…", durch werkstatt-backend). Modell:
**persistente Agents + Task-Assignment** — ein Task wird einem Agent zugewiesen (`assignee_email`),
sein Schedule pullt ihn, er implementiert via git+Forgejo-API (eigene Identität, KEIN Adapter, KEIN
gh/tea), öffnet PR. Mein A3 `tasks.update`(assignee) ist GENAU das Zuweis-Tool für einen Treiber.
→ Die ganze „Ephemeral-Worker-Spawnen + coding-loop + Forge-Adapter (A2/A7)"-Kaskade war der FALSCHE
Pfad. A1 (recipe_params)/A3 (tasks.update) bleiben nützlich; A2/A7 (Materialization/Adapter) GESTRICHEN.
**Warum es gerade idlet:** Treiber (Opus-Motor, der Tasks zuwies) pausiert + Backlog auf Owner-
Entscheidungen blockiert. Kein Capability-Gap — ein Treiber- + Backlog-Problem.
**Einfacher Pfad:** ein Treiber (PM via tasks.update / CEO / Owner) weist actionable Tasks zu → Agents
self-coden. Mechanik bewiesen (werkstatt-bot PR #6, agent PR #5).

- [x] PM-Orchestrator live, getiert (gpt-5.5/high), triagiert echten Backlog, fan-out-Logik bewiesen.
- [x] agent-spawn löst auf Owner-Nest auf (Fix deployed, PR `fix/pm-agent-spawn-owner`).
- [ ] **A1 — agent.spawn Recipe-Params:** der `agent.spawn`-Tool sendet leere `recipe.params:{}`;
  Worker-Personas (backend-engineer) brauchen `org_id`. Fix: `params`-Feld am Tool + PM-Recipe
  instruiert org_id/team_id mitzugeben. (Code-Fix klar; Deploy = Nest-Rebuild.)
- [ ] **A2 — Worker-Execution-Modell (verifiziert — wichtige Erkenntnis):** der ECHTE Code-Loop
  (worktree→edit→verify→**PR**→merge-gate) lebt in `packages/agent-runtime/src/coding/coding-loop.ts`
  und ist **orchestrator-owned + ISSUE-getrieben** (`apes agents code --issue <n> --repo <url>`,
  coding-loop.ts:171 macht den PR — NICHT ein LLM-Tool). Die backend-engineer/technical-writer-
  Personas pullen zwar zugewiesene Tasks (`assignee_email==$ME`, `/15`-Schedule) + editieren, haben
  aber **kein forge.pr-Tool** → können selbst KEINEN PR öffnen (Pattern B unvollständig). **Noch nie
  in PROD bewiesen** (keine Agent-PRs in der git-Historie). → Entscheidung: den BEWIESENEN Loop nutzen
  (`apes agents code`), nicht Pattern B fertigbauen. Impedance: tasks.openape.ai-Task ≠ git-Issue →
  Bridge nötig (PM erzeugt Forge-Issue aus Task ODER coding-loop nimmt Task-Brief statt Issue).
- [x] **A3 — `tasks.update`-Tool (assignee/status/team_id) + team_id auf tasks.create:** committed
  (`d70ad427`). Deploy mit A1 in EINEM Nest-Rebuild.
- [x] **A6 — Forge-Auth (least-priv, ENTSCHEIDUNG Patrick):** dedizierter Forgejo-Machine-User
  **`werkstatt-bot`** (id 7), NUR write-Collaborator auf `patrick/werkstatt-sandbox`. Token-Scope
  `write:repository,write:issue` (kein read:user). Beweis: Bot sieht sandbox (200), `patrick/openape`
  404. Token in Nest `/var/lib/openape/nest/.secrets/forgejo-bot-token` (root 600). Bot-PW NICHT
  gespeichert (per admin-PATCH resetbar). Siehe [[reference_werkstatt_bot_forge]].
- [ ] **A7 — Forgejo/Gitea Forge-Adapter (NEUER BLOCKER, fundamental):** `coding/forge.ts` hat NUR
  github+azure eingebaut → `detectForge` wirft auf git.openape.ai. Kein Agent kann auf Forgejo PRen
  (= das ganze OpenApe-Monorepo!). Fix: `ForgeAdapter` für Forgejo registrieren (`tea`-CLI ODER
  Forgejo-API als Command-Builder; `tea` ist im Nest NICHT installiert → entweder installieren oder
  API-basiert). Sauber + unit-testbar (pure command-builder), aber Fundament-Arbeit + Runtime-Dep.
  Erst danach ist der Code-Loop auf Forgejo lauffähig.
- [ ] **A4 — Worker-E2E:** PM nimmt 3 Quick-Wins → 3 parallele getierte Worker → echte PRs → PM gated.
- [ ] **A5 — Opus-launchd-Motor retiren (M6):** ein Treiber (PM), nicht zwei (verhindert die
  Backlog-Churn die wir gesehen haben). Erst NACH A4, wenn der PM nachweislich treibt.

### Track B — Steuerung & Struktur (parallel)
- [ ] **B0 — Troop+Org zusammenwachsen (ENTSCHIEDEN 2026-06-15, gestuft):** EIN Produkt, zwei innere
  Ebenen — Troop = Kontrollebene (Maschinen-Konsumenten: CLI + Nests + Scopes → tragende Wand,
  byte-stabil halten), Org = Geschäftsebene (Owner-UI, keine externen Konsumenten → formbar).
  Reibung heute: Agent 4× verstreut (IdP/Troop-`agents`/Org-`org_members`/Tasks-`team_members`),
  nur per E-Mail-String verbunden, kein FK → Placeholder-PK-Swap, Zwei-Hop-Spawn, org_id≠team_id.
  - **B0/Stufe 1 = B3a:** Daten verknüpfen (FK statt String-Match, org↔tasks-Team) — billig, killt ~80%
    der Reibung, keine Breaking Changes. Wird in der B3-Arbeit miterledigt.
  - **B0/Stufe 2:** Deployables verschmelzen — **Org wandert in den Troop-Backend** (Troops API/WS/Domain
    bleiben byte-stabil: `/api/agents/me/*`, Nest-WS, `/api/nests/token`, `spawn-intent`, `cli/exchange`;
    Domain-Umzug nur mit `OPENAPE_TROOP_URL`-Override + Ankündigung). Auth schon getrennt (Owner-Session
    deckt beides, Agents bleiben Bearer).
  - **B0/Stufe 3:** EIN Owner-UI mit GETRENNTEN Views „Firma" (OrgChart/Vision/Produkte/Kosten) vs
    „Betrieb/Agents" (Config/Runs/Secrets/Nests) — nie den Maschinenraum aufs Firmen-Dashboard kippen.
- [ ] **B1 — Roadmap-Mechanik:** diese Datei + Spiegelung in Org-Objectives; CEO pflegt die
  Roadmap-Tracks; PM dispatcht dagegen. Weekly-Report (existiert schon als Report-Kind) = Patricks
  Steuer-Cockpit.
- [ ] **B2 — Decision Queue:** gebündelte Owner-Entscheidungs-Liste (1 Ort, batched), statt
  Einzel-Eskalationen pro Tick. Kandidat: ein Tasks-Status/Tag `needs-owner` + Weekly-Digest.
- [ ] **B3 — Produkt/Team-Layer in ORG (ENTSCHIEDEN 2026-06-15: „eine Firma, viele Produkte"):**
  bestätigte Grundlage, nicht mehr optional. Eine ORG (Firma) hat mehrere **Produkte/Teams**; der
  CEO steuert quer darüber; je Produkt eigener Backlog (tasks-Team) + Lead. Gestuft bauen:
  - **B3a (Datenmodell):** `org_teams`/Produkt-Entity + `team_id` an objectives/members; ORG↔tasks-
    Team-Linkage (löst auch den org_id≠team_id-Bug). Das macht „eine Firma, viele Produkte" real.
  - **B3b (CEO-Cross-Produkt):** CEO-Persona liest per-Produkt-Status + alloziert über Produkte;
    PM dispatcht per-Produkt-Backlog.
  - **B3c (UI):** OrgChart-Redesign (Produkt-Karten) — zuletzt, Agents brauchen kein UI.
  Reihenfolge: B3 kommt NACH Track A (Worker müssen erst ausführen), VOR/MIT Delta Mind (C wird
  als Firma-mit-Produkten gebaut).

### Track C — Delta Mind (PROD, der eigentliche Wert)
Delta Mind = **eine Firma mit mehreren Produkten** (Email-Assistent, Buchhaltungs-Assistent, später
otk-es/Koompl). Wird auf dem B3-Produkt-Layer gebaut. CEO steuert quer über die Produkte.
- [ ] **C1 — Firma anlegen:** Delta Mind als org.openape.ai-Org + Vision + CEO.
- [ ] **C2 — Produkt „Email-Assistent":** Persona mit `mail.list`/`mail.search` (o365-cli ist da). Hilft beim
  Triage analog `/auto-mail`. Tooling READY.
- [ ] **C3 — Buchhaltungs-Assistent:** Persona für Buchhaltung. **Tooling-GAP:** kein Ledger/Invoice-
  Tool. V1 hilft via Email/Docs/bash + `/buchhaltung`-Domänenwissen (Bill-To-Regeln, Ablage), KEINE
  echte Buchhaltungs-Integration. Echte Integration = späterer Milestone.
- Abhängigkeit: C2/C3 führen erst echt aus, wenn Track A (Worker-Execution) steht.

## Diskussion: Teams/Departments in ORG?

**Ist-Stand (verifiziert):** ORG ist flach — `org_members` (Rolle + `reportsToEmail`-Hierarchie),
EINE org-weite `objectives`-Liste, CEO liest EINEN Inbox, KEINE Teams. ORG↔tasks-Team entkoppelt.
CEO hat kein Multi-Team-Konzept. Eine ORG ≈ heute ein Team mit Hierarchie.

**Change-Surface für echte Teams:** ~1500–2000 Zeilen — Schema (org_teams + team_id-Felder),
4–6 Org-Endpoints, CEO-Persona (Multi-Team-Loop + per-Team-Reports), OrgChart-UI-Redesign,
ORG↔tasks-Team-Sync, per-Team-Cost.

**Empfehlung (zur Diskussion):**
- Der *Bedarf* ist echt (parallele Produkte, „blocked→continue elsewhere", CEO über mehrere).
- ABER: „blocked→continue elsewhere" ist primär **Workflow** (parallele Roadmap-Tracks + PM zieht
  Unblockiertes + Decision Queue), nicht **Datenmodell**. Das liefern wir in Track B OHNE die 2000-Zeilen.
- Für Delta Minds 2 Assistenten sind formale Teams **Overkill** → flache Org + parallele Personas.
- → **Phase 1 (jetzt):** flache Orgs, parallele Personas, Roadmap-Tracks + Decision Queue.
  **Phase 2 (wenn es sich verdient):** formaler Team/Department-Layer mit CEO-Cross-Team-Steuerung,
  sobald 3+ parallele Produkte ODER eigene per-Produkt-Leads/Budgets gebraucht werden.
- Offen für Patricks Sicht: denkst du eher „eine Firma, viele Produkte" (→ Teams bald nötig) oder
  „mehrere schlanke Orgs" (→ Teams unnötig, je Org eine flache Struktur)?

## Decision Log
| Datum | Entscheidung | Begründung |
|-------|-------------|------------|
| 2026-06-15 | Track A vor Track C | Worker-Execution ist Voraussetzung für jeden PROD-Assistenten |
| 2026-06-15 | **„Eine Firma, viele Produkte" (Patrick)** | Datenmodell folgt dem mentalen Modell; CEO über mehrere Produkte. Produkt/Team-Layer (B3) = bestätigte Grundlage, kein YAGNI-Aufschub. Reihenfolge: A → B3 → C |
| 2026-06-15 | Worker-Execution: getierte Standard-Personas + Task-Assignment | PM nutzt die RICHTIGE Persona je Task (backend-engineer/scribe…) statt eines Generikers; weist den Task dem Worker zu (braucht `tasks.update`-Tool A3). Verifizieren ob die Personas zugewiesene Tasks ausführen |
| 2026-06-15 | **Troop+Org zusammenwachsen, gestuft (Patrick)** | Ein Produkt, zwei Ebenen; Reibung durch 4× verstreute Agent-Identität. Stufe 1 (Verknüpfen) = B3a, billigster 80%-Wert; Org→Troop-Backend; Troop-Maschinen-Surface byte-stabil; getrennte UX-Views. Endpunkt der „eine Firma viele Produkte"-Richtung |
