# Plan: Agent-Activity-Logging (Worker-Backbone + Agent-Detail)

> Self-contained. Ziel: die Arbeit der troop-Operator/Agents landet vollständig im Activity-Log,
> damit der invoice-Skill (`collect-activity.ts` → Leistungsbericht) korrekt und lückenlos bleibt.
> Cross-Repo: openape-monorepo (troop + worker-assets), `~/.claude` (claude-log), `linde-invoices` repo.

## Purpose / Problem (grounded)

- Der invoice-Skill (`~/.claude/commands/invoice.md`, Schritt 5) läuft `collect-activity.ts` in
  `~/Companies/delta-mind/repos/linde-invoices/` — **strikt read-only**, liest `~/.claude/activity-logs/*.jsonl`
  (Felder: `ts, sid, action, project, company, type`) + PRs → baut den Leistungsbericht (Projekt-%-Verteilung).
- **Der Log wird heute nur in interaktiven Claude-Code-Sessions gefüllt:** manuelle `claude-log`-Calls +
  ein Auto-Hook (`sid:"hook"`). `claude-log` ist eine **zsh-Shell-Funktion**, kein PATH-Binary.
- **Die headless Operator/Agents (Worker) laufen außerhalb:** können die Funktion nicht aufrufen, triggern
  keinen Hook → ihre Arbeit ist im Log unsichtbar → Rechnung unter-berichtet.
- **Entscheidung (Patrick, 2026-07-16):** „Beides" — deterministischer Worker-Backbone (Vollständigkeit) +
  optionaler Agent-Detail-Log (Feinheit).

## Architektur-Anker

- **Eine Identitäts-Quelle:** jede troop-Org trägt ihre Log-Identität `{project, company, type}` (in
  `org.vars.activityLog`). Von dort fließt sie in BEIDE Pfade — Worker (Task-Payload) und Agent (Memory).
- **Zwei Log-Quellen, klar markiert:** Worker-Backbone → `sid:"op-auto"`, Agent-Detail → `sid:"op-agent"`.
  So kann `collect-activity.ts` Überlappung sauber behandeln (siehe Decision unten).
- **claude-log wird ein Script** (`~/.local/bin/claude-log`), die Shell-Funktion delegiert dorthin — EINE
  Implementierung, aufrufbar auch headless.

## OFFENE DESIGN-ENTSCHEIDUNG (vor M3/M5 klären)

**Doppelzählung Worker-Backbone vs. Agent-Detail für denselben Task.** Beide loggen ggf. dieselbe Arbeit →
im Leistungsbericht würde ein Projekt doppelt gewichtet. Optionen:
- **(a) collect-activity dedupt nach `sid`-Präfix:** pro Task/Zeitfenster: gibt es `op-agent`-Einträge, zählen
  NUR die; sonst der `op-auto`-Backbone. Backbone = reines Fallback. **Empfohlen** — nutzt Detail wenn da,
  Vollständigkeit sonst.
- **(b) Backbone zählt nie (nur Coverage), Detail zählt:** einfacher, aber wenn der Agent nie loggt, fehlt die
  Gewichtung (nur „es passierte was").
- **(c) Nur eine Quelle je Org konfigurierbar:** pro Org entweder Backbone ODER Detail, nie beides.

→ Diese Wahl steuert M5 (`collect-activity.ts`). Patrick entscheidet vor M3.

## Repo-Orientierung

- `~/.claude/` (privat): `claude-log`-Funktion (Quelle finden: `.zshrc`/gesourcetes File), `activity-logs/`.
- `linde-invoices` repo: `src/collect-activity.ts` (Log-Reader).
- openape-monorepo:
  - `apps/openape-troop/server/database/schema.ts` — `organizations.vars` (JSON) trägt `activityLog`.
  - `apps/openape-troop/server/api/cockpit/message.post.ts` — enqueued Task; **logIdentity beilegen**.
  - `apps/openape-troop/server/utils/cockpit/queue.ts` — `QueueTask` + `enqueue` (Feld ergänzen).
  - `apps/openape-troop/server/api/cockpit/agent/tasks/next.post.ts` — Task-Payload an Worker (logIdentity mitgeben).
  - `apps/openape-troop/public/worker/worker.sh` — nach `answer()` Backbone-Log schreiben; Directive-LOGGING.

## Milestones

### M1: `claude-log` als PATH-Script (Prerequisite)
- Quelle der Funktion finden; identisches Script `~/.local/bin/claude-log` anlegen (gleiche JSONL-Ausgabe,
  optionaler 5. Param `sid`-Override, default aus `$CLAUDE_SESSION_ID`).
- Shell-Funktion → delegiert an das Script (eine Impl).
- **AK:** `bash -lc 'claude-log a b c d'` UND `zsh -ic 'claude-log a b c d'` schreiben denselben Eintrag;
  ein headless `bash -c` (ohne Profil, PATH=~/.local/bin:...) findet das Script.

### M2: Org-Log-Identität (Quelle in troop)
- Pro Org `vars.activityLog = {project, company, type}` setzen (API). Mapping: Delta Mind→(general/Delta Mind/admin),
  IURIO→(IURIO/Legal Tech Services/code), OpenApe→(openape/Delta Mind/code), privat→(general/personal/admin).
- Im Operator-Memory eine „Activity-Log"-Zeile surfacen (für den Agent-Pfad).
- **AK:** jede Org hat `vars.activityLog`; taucht im Operator-Prompt auf.

### M3: Worker-Backbone (deterministisch)
- `message.post`/`queue`/`next.post`: `logIdentity` (aus `org.vars.activityLog`) in den Task-Payload.
- `worker.sh`: nach erfolgreichem `answer()` einen Eintrag via `claude-log "<userMessage[:90]>" <project>
  <company> <type>` mit `sid=op-auto` (Script-Param) schreiben — nur Cockpit-Tasks, nur bei Erfolg.
- **AK:** ein Cockpit-Task → genau ein `op-auto`-Eintrag im heutigen Log mit korrekter company/project.

### M4: Agent-Detail (Directive)
- Directive-LOGGING-Block: „handlungsrelevante Aktionen mit `claude-log <action> <project> <company> <type>`
  (Werte aus deinem Memory), sid `op-agent`." Sync (3 Orte) + Worker-Neustart.
- **AK:** ein Task, bei dem der Agent real arbeitet (Mail archivieren) → zusätzlich ein `op-agent`-Eintrag.

### M5: collect-activity.ts an neue Quellen anpassen
- Gemäß Design-Entscheidung (a/b/c) `op-auto`/`op-agent` behandeln (dedup/Gewichtung).
- **AK:** Leistungsbericht eines Monats mit Operator-Arbeit zählt jede Arbeit **einmal**, korrekt verteilt.

## Verifikations-Reihenfolge

M1 lokal (Shell-Tests) → M2 API → M3 worker-sync+neustart, ein Live-Cockpit-Task erzeugt einen op-auto-Eintrag
(read-only im Log prüfen) → M4 dito op-agent → M5 collect-activity gegen einen Test-Monat. Worker-Änderungen =
worker-only (kein troop-Deploy); die troop-Änderungen (M3 Task-Payload) brauchen einen troop-Deploy.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-07-16 | Beides: Worker-Backbone + Agent-Detail | Abrechnung braucht Vollständigkeit (Worker) + Feinheit (Agent) | nur Agent (Lücken); nur Worker (grob) |
| 2026-07-16 | claude-log wird PATH-Script | headless aufrufbar; eine Impl | Funktion behalten (nicht headless-aufrufbar) |
| 2026-07-16 | Log-Identität in org.vars (eine Quelle) | kein Hardcode in worker.sh; fließt in beide Pfade | Mapping in worker.sh; nur in Memory |
| 2026-07-16 | Überlappung = (a) Detail bevorzugen, Backbone Fallback | Feinheit wenn da, Vollständigkeit sonst; keine Doppelzählung | (b) Backbone nur Coverage; (c) eine Quelle/Org |

## Progress

- [x] `[2026-07-16]` Plan erstellt + Überlappungs-Entscheidung (a). Freigabe erteilt.
- [x] `[2026-07-16]` **M1 done+verifiziert:** `~/.local/bin/claude-log` = echtes Script (JSON-sicher via python,
      optionaler 5. `sid`-Param für op-auto/op-agent). `~/.zsh_shared/commands/claude-log.zsh` delegiert dorthin
      (eine Impl). Getestet: Script direkt, headless (`env -i`, minimaler PATH), Funktions-Delegation, Quote-Escaping
      — alles gegen temp-HOME (echter Log unberührt).
- [ ] M2 Org-Log-Identität · M3 Worker-Backbone (+troop-Deploy) · M4 Agent-Detail-Directive · M5 collect-activity.ts (a).
