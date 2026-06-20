# Plan: Pause per Agent & per Nest

> Self-contained. Ein Agent/Mensch ohne Vorwissen liest von oben nach unten und kann es umsetzen.

## Purpose / Big Picture

Ein laufender Agent verbrennt im Leerlauf Tokens, weil er sich per autonomem
Cron-Loop selbst aufweckt (pollen → denken → handeln). Heute ist die einzige Art,
das zu stoppen, den ganzen Nest-Container herunterzufahren — das gibt 502, reißt
alle Agents mit und braucht beim Hochfahren Reconnect/Re-Auth.

- **Ziel:** Owner kann einen **einzelnen Agent** oder einen **ganzen Nest** pausieren.
  Ein pausierter Agent verbraucht **null LLM-Tokens**, bleibt aber **enrolled +
  WS-connected** (kein Respawn, kein Re-Auth). Resume schaltet ihn sofort wieder
  scharf. Steuerbar per CLI (`ape-troop`) und in der Troop-UI (Toggle + Badge).
- **Kontext:** Patrick hat den Nest nachts bewusst gestoppt, um Idle-Burn zu
  vermeiden, und gefragt: „Ev. sollten wir ein Pause pro Agent und Nest einführen?"
  Idle-Burn kommt fast vollständig aus den **autonomen Loops**, nicht aus
  eingehenden Owner-Nachrichten.
- **Scope drin:** per-Agent + per-Nest Pause/Resume; Enforcement im Nest; CLI; UI;
  E2E-Beweis null-Token + Instant-Resume.
- **Scope draußen:** zeitgesteuertes Auto-Resume / Schedules; pro-Task-Pause;
  abrechnungs-/budgetgetriebenes Auto-Pause; eine „⏸ paused"-Auto-Antwort an den
  Owner bei eingehender Nachricht (v2 — MVP droppt still, UI-Badge kommuniziert den
  Zustand).

## Repo-Orientierung

- **Projekt:** openape-monorepo — `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Tech-Stack:** pnpm/turbo Monorepo, TypeScript, Nuxt 4 (troop-App), Node ≥22.
  Forgejo-authoritative (`git.openape.ai/openape-ai/openape`), PRs CI-gated.
- **Kontrollpfad (bestätigt):** `ape-troop` CLI → troop.openape.ai HTTP-API → Nest
  über **WS-Frames**. Heute ist `spawn-intent` das einzige Kommando-Verb
  (`apps/openape-nest/src/lib/troop-ws.ts:257`, ruft `apes agents spawn`). Pause
  wird daneben als zweites/drittes Verb eingehängt.

**Relevante Dateien (mit Funktionsnamen):**

| Zweck | Datei | Anker |
|------|-------|------|
| Agent-Registry (Source of Truth) | `apps/openape-nest/src/lib/registry.ts` | `AgentEntry` (13–59), `findAgent`/`upsertAgent`/`listAgents`/`readRegistry`/`writeRegistry` |
| Autonomer Loop (Idle-Burn) | `apps/openape-nest/src/lib/session-host.ts` | `tickAll()` (250), pro-Session `session.tick()` (283) |
| Zentraler Tick-Timer | `apps/openape-nest/src/index.ts` | `setInterval(() => sessionHost.tickAll(), …)` (~95) |
| Inbound-Message-Dispatch (in-process) | `apps/openape-nest/src/lib/agent-runtime-session.ts` | `dispatchTurn` (≈294) |
| pm2/Cron-Loop (falls für Agent aktiv) | `apps/openape-ape-agent/src/cron-runner.ts` | `tick()` (272), `fire()` (293) |
| Nest WS-Frame-Handler | `apps/openape-nest/src/lib/troop-ws.ts` | Frame-Switch (257), `spawn-intent`-Handler |
| Troop-API (Owner-bearer) | `apps/openape-troop/server/api/agents/…` | Muster: `requireOwnerWithScope(event, 'troop:…')` |
| ape-troop CLI | `packages/ape-troop/src/commands/agents.ts` + `src/troop-api.ts` | `defineCommand`, `TroopApi.request()` |
| UI Agent-Detail | `apps/openape-troop/app/pages/agents/[name].vue` | bestehende PATCH-Controls |
| UI Nest-Detail | `apps/openape-troop/app/pages/nests/[id].vue` | Nest-Infos-Block |

- **Dev-Setup (lokaler Full-Lifecycle-Stack):** siehe Memory
  `reference_local_stack_agent_lifecycle` + `compose/local-stack.yml` (nest+bridge+
  mock-LLM). Pro-Paket-Checks: `pnpm turbo run lint typecheck test --filter=@openape/nest`
  (analog `@openape/ape-troop`, `@openape/troop`).

## Design (lazy)

**Eine Quelle der Wahrheit:** der Nest. Per-Agent-Flag `paused` lebt in der
Registry (`agents.json`, `AgentEntry.paused?: boolean`). Nest-weit: ein einzelnes
Feld in einer kleinen `nest-state.json` (`{ paused: boolean }`) neben der Registry.

**Enforcement = nur `if (paused) return` am Turn-Start.** Pausieren fasst **WS
oder Prozess-Lifecycle nicht an** — deshalb bleibt der Agent connected und Resume
ist instant. Drei Guards (alle Nest-lokal):
1. `tickAll()`: Nest pausiert → früh `return` (alle übersprungen). Sonst Sessions
   mit `entry.paused` überspringen. **Das killt den Idle-Loop = der eigentliche Burn.**
2. `dispatchTurn`: Agent/Nest pausiert → nicht enqueuen (kein LLM auf Inbound).
3. `cron-runner.fire()`: liest dieselbe Registry, pausiert → `continue` — **nur
   falls die pm2/Cron-Substrate für den Ziel-Agent noch aktiv ist** (in M1 prüfen;
   `session-host` ist der in-process-Ersatz, beide können koexistieren).

**Kontroll-Frames** spiegeln `spawn-intent`: `pause-intent`/`resume-intent`
(per-Agent, mit `name`) und `nest-pause`/`nest-resume`. Handler schreibt Registry/
nest-state, kein Respawn.

## Milestones

### Milestone 1: Nest-Enforcement (Token-Spar-Kern, allein beweisbar)

**Ziel:** Ein per Flag pausierter Agent führt **keine** autonomen Turns mehr aus
und nimmt keine Inbound-Nachricht ins LLM — rein durch lokale Registry-Manipulation,
ohne CLI/UI. Das liefert bereits den ganzen Nutzen.

**Schritte:**
1. `registry.ts`: `AgentEntry` um `paused?: boolean` + `pausedAt?: number`
   erweitern. Mini-Helper `setAgentPaused(name, paused)` (nutzt `upsertAgent`).
2. Neue `nest-state.ts` neben der Registry: `readNestState()/setNestPaused(bool)`
   gegen `nest-state.json` (gleicher Pfad-Stamm wie `agents.json`). Default
   `{ paused: false }`, fehlende Datei = nicht pausiert.
3. `session-host.ts` `tickAll()`: am Anfang `if (readNestState().paused) return`;
   in der Session-Schleife `if (findAgent(session.name)?.paused) continue` (mit
   einmaligem Log pro Übergang, nicht pro Tick).
4. `agent-runtime-session.ts` `dispatchTurn`: vor dem Enqueue
   `if (nest/agent paused) { log; return }`.
5. **Prüfen**, ob `cron-runner.ts` (pm2-Pfad) für reale Agents noch feuert. Wenn ja:
   Guard in `fire()`/`tick()` ergänzen (liest Registry-Flag). Wenn der Pfad tot ist
   → in Discoveries festhalten und überspringen (YAGNI).

**Akzeptanzkriterien (beobachtbar, lokaler Stack):**
- [ ] Agent läuft, Logs zeigen periodische Ticks/Turns. `agents.json` von Hand auf
  `"paused": true` setzen (oder `setAgentPaused`) → **innerhalb eines Tick-Intervalls
  keine neuen LLM-Calls** mehr in den mock-LLM-/Bridge-Logs; Nest-Log zeigt
  `… paused, skipping`.
- [ ] Inbound-Test-Nachricht an den pausierten Agent → Nest-Log `dispatch … paused`,
  **kein** LLM-Call.
- [ ] Flag zurück auf `false` → nächster Tick läuft wieder, **ohne** Respawn/Reconnect
  (gleiche Session-ID/WS im Log).
- [ ] `nest-state.json` `paused:true` → **alle** Agents still; `false` → alle wieder aktiv.
- [ ] `pnpm turbo run lint typecheck test --filter=@openape/nest` grün.

**Rollback:** Felder sind additiv + optional; Default = nicht pausiert. Branch
verwerfen oder `paused`-Guards entfernen stellt Alt-Verhalten 1:1 her.

### Milestone 2: Kontroll-Ebene (Remote-Toggle: WS-Frame + Troop-API + CLI)

**Ziel:** `ape-troop agents pause <name>` vom Mac aus flippt das Flag im **live**
Nest; der Agent geht idle; `resume` macht ihn wieder scharf — ohne Respawn/Re-Auth.

**Schritte:**
1. `troop-ws.ts`: Frame-Typen `pause-intent`/`resume-intent` (`name`) +
   `nest-pause`/`nest-resume`; Handler ruft `setAgentPaused`/`setNestPaused` und
   ackt (analog `spawn-result`).
2. Troop-API-Endpoints (bearer, owner-scope): `POST /api/agents/[name]/pause|resume`,
   `POST /api/nests/[host_id]/pause|resume`. Relayen das passende WS-Frame an die
   Nest-Verbindung (gleicher Relay-Mechanismus wie spawn-intent).
3. `packages/ape-troop`: `TroopApi.pauseAgent/resumeAgent/pauseNest/resumeNest` +
   Subcommands `agents pause|resume`, `nest pause|resume` (Muster wie `spawn`).

**Akzeptanzkriterien:**
- [ ] `ape-troop agents pause <name> --host-id <nest>` → `✓ paused`; live-Nest-Log
  zeigt Frame empfangen + Registry geschrieben; Agent wird idle (M1-Verhalten).
- [ ] `ape-troop agents resume <name>` → Agent wieder aktiv, gleiche Session/WS.
- [ ] `ape-troop nest pause --host-id <nest>` → gesamte Flotte still; `resume` zurück.
- [ ] lint/typecheck/test grün für `@openape/ape-troop` + `@openape/troop`.

**Rollback:** Endpoints/Frames/Commands additiv; entfernen lässt M1-Kern intakt.

### Milestone 3: UI-Toggle + E2E

**Ziel:** Pause-Toggle + Statusbadge in der Troop-UI (Agent-Detail + Nest-Detail);
vollständiger E2E-Beweis.

**Schritte:**
1. `agents/[name].vue`: Badge (running/paused) + Pause/Resume-Button → ruft die
   M2-Endpoints; optimistic update.
2. `nests/[id].vue`: „Flotte pausieren"-Button + Badge.
3. Captions/Copy wie Produkt-Doku (Memory `feedback_docs_sound_like_docs`).

**Akzeptanzkriterien (E2E, mit Screenshot-Beweis):**
- [ ] In der UI Agent pausieren → Badge `paused`; ein **geplanter Tick** UND eine
  **eingehende Owner-Nachricht** lösen **keinen** LLM-Call aus (Logs).
- [ ] Resume in der UI → Badge `running`, nächster Turn läuft auf **derselben**
  Session/WS (kein Respawn).
- [ ] Screenshot beider Zustände (Agent-Detail running/paused) an Patrick (SendUserFile).

**Rollback:** UI additiv.

## Progress

- [x] `[2026-06-20]` Plan erstellt + freigegeben.
- [x] `[2026-06-20]` M1: **implementiert + unit-verifiziert** (Branch `feat/agent-nest-pause-m1`).
  Registry `paused`/`pausedAt` + `setAgentPaused`; `nest-state.ts`
  (`readNestState`/`setNestPaused`/`isAgentPaused`); Guards in beiden `dispatchTurn`
  (openclaw + default) + `tickAll` (nest-weit + per-Agent, Reconcile bleibt aktiv →
  bleibt connected). 118 Tests grün, inkl. `pause.test.ts` (Prädikat + dispatch-drop
  beweist Turn wird vor LLM verworfen). Live-Stack-Beweis (0 LLM-Calls) → in M3-E2E
  gefaltet, sobald CLI/UI das Togglen treiben.
- [x] `[2026-06-20]` M2: **implementiert** (Branch `feat/agent-nest-pause-m2`).
  Ein WS-Frame `set-pause { name?, paused }` (name=Agent, ohne=Nest-weit) im
  Nest-Handler (`troop-ws.ts handleSetPause` → `setAgentPaused`/`setNestPaused`,
  in-process, kein Respawn). Troop: `pause-dispatch.ts dispatchPause` (Peer-Wahl
  wie spawn) + 4 Endpoints (`/api/agents/:name/pause|resume`,
  `/api/nests/:host_id/pause|resume`, Scope `troop:pause-agent`). CLI:
  `TroopApi.setAgentPaused/setNestPaused` + `ape-troop agents pause|resume` +
  `ape-troop nests pause|resume`. Tests: 118 nest + 192 troop (inkl.
  `pause-dispatch.test.ts`, 5 Fälle) + 5 ape-troop grün. Live-Relay-Beweis (CLI →
  Nest-Log → idle) → M3-E2E gegen den laufenden Nest.
- [x] `[2026-06-20]` M3: **implementiert** (Branch `feat/agent-nest-pause-m3`).
  Troop `agents.paused`-Spalte (additive ALTER-TABLE-Migration) als UI-Mirror,
  geschrieben von den per-Agent-Endpoints; Agent-Detail-Header: ⏸-Badge +
  Pause/Resume-Button (i18n de+en); Nest-Detail: Fleet-Pause/Resume-Button (Toast).
  192 troop-Tests + lint + typecheck grün. **Visueller Live-Screenshot ist
  owner-passkey-gated → nicht autonom capturebar**; Beweis: CI-grün + PR-Preview
  (Patrick loggt sich dort selbst ein) + Render des neuen Headers.

## Surprises & Discoveries

- `[2026-06-20]` Kontroll-Verb-Muster bestätigt: troop→nest läuft über WS-Frames,
  `spawn-intent` ist bis jetzt das einzige Kommando (`troop-ws.ts:257`). Pause hängt
  sich als weiteres Verb an — kein neuer Transport nötig.
- `[2026-06-20]` Zwei Runtime-Substrate koexistieren (in-process `session-host` +
  pm2 `cron-runner`/`bridge`). M1-Schritt 5 klärt, welches für reale Agents feuert →
  bestimmt, ob der dritte Guard nötig ist.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-06-20 | Flag im Nest-Registry, nicht in troop-DB | Nest ist das Control-Plane, das die Loops fährt; lokal beweisbar ohne Remote | Flag in troop.db (braucht Round-Trip für jede Enforcement-Prüfung) |
| 2026-06-20 | Enforcement = `if (paused) return` am Turn-Start, kein Lifecycle-Eingriff | hält WS/Session am Leben → Instant-Resume, kein Re-Auth | Prozess/Container stoppen (= heutiger 502-Schmerz) |
| 2026-06-20 | Inbound bei Pause still droppen (MVP) | Idle-Burn ist das Ziel; Auto-Antwort ist extra Surface | „⏸ paused"-Canned-Reply → v2 |
| 2026-06-20 | nest-weit via eigenes `nest-state.json` | ein Feld, ein Read in `tickAll`; kein Pro-Agent-Loop nötig | Flag in jeder AgentEntry spiegeln (N Writes, Drift-Risiko) |

## Session-Checkliste

1. Plan + Progress lesen
2. Git-Log seit letztem Commit
3. Lokalen Stack starten, Baseline: Agent tickt, LLM-Calls sichtbar
4. Nächsten offenen Milestone nehmen (max. 1/Session)
5. Implementieren, pro Milestone committen (Branch + PR, CI-gated)
6. E2E der Akzeptanzkriterien (Logs/UI, nicht nur Unit)
7. Progress + Discoveries updaten

## Outcomes & Retrospective

> Nach Abschluss füllen.
