# Plan: input-required — Rückfragen & gated Actions im Cockpit-Task-Flow (#981)

> Dieser Plan ist self-contained: ohne Vorwissen von oben nach unten ausführbar.

## Purpose / Big Picture

- **Ziel:** Der Operator kann mitten in einem Task eine Rückfrage mit 2–4 Antwort-Chips stellen („WhatsApp-Muster oder Swipe?") oder eine gated Action anbieten („Deploy troop prod-xxx? [Ja] [Nein]"). Patrick tippt einen Chip im Cockpit-Chat — der **selbe Task** läuft mit der Antwort weiter, kein neuer Verlauf, kein Kontextverlust.
- **Kontext:** Issue #981. Beim Mobile-Layout-Fix (2026-07-21) gab es beides manuell: eine Produktentscheidung per Frage-Dialog und gated Deploy/Merge. Der Operator kann heute nur `completed|failed|deferred` — bei fehlender Entscheidung muss er raten oder abbrechen.
- **Scope:** Cockpit-Queue + Worker-CLI + Cockpit-Chat-UI in `apps/openape-troop`. Gated Actions sind **keine Sonderbehandlung** — nur eine Frage mit Ja/Nein-Chips; die Aktion führt der Operator nach der Antwort selbst aus. NICHT drin: `packages/sp-tasks` (externe Services später), Freitext-Pflicht (Chips + das normale Eingabefeld reichen), Mehrfachfragen pro Task-Turn.

## Repo-Orientierung

- **Projekt:** openape-monorepo, App `apps/openape-troop` (Nuxt 4, h3, Drizzle/LibSQL, Vitest)
- **Relevante Dateien:**
  - `server/utils/cockpit/queue.ts` — in-memory Queue; `TaskState`, `QueueTask`, `resolve()`, `claimNext()`, `restoreTask()`. Muster: #983/#989 (deferred/notBefore) — dieselbe Mechanik.
  - `server/utils/cockpit/task-store.ts` — Durability (`cockpit_tasks`); `StoredTask`, `saveTask` (Upsert), `loadAndPrunePending`
  - `server/utils/cockpit/chat-store.ts` — `saveChatMessage(orgId, owner, role, content)`; Web-Push bei assistant
  - `server/api/cockpit/agent/tasks/resolve.post.ts` — Worker-Resolve; Owner-Guard-Muster (`task.owner === agent`)
  - `server/api/cockpit/message.post.ts` — Owner-SSE-Stream; `isClaimed`-Loop wertet `t.state` aus, `MAX_STREAM_MS=240s`
  - `server/api/cockpit/messages.get.ts` — persistierte Konversation (Reload-Pfad)
  - `public/worker/cockpit-agent.sh` — Worker-CLI (`resolve <id> <state> [retryInMs]`); `worker.sh` → `COCKPIT_DIRECTIVE`
  - `app/composables/useCockpitChat.ts` — send/SSE-Parse (`k:'tok'|'think'|'wait'|…`), `reattachProgress`
  - `app/components/cockpit/CockpitBubble.vue` + `app/utils/cockpit/types.ts` (`ChatMessage`) + `app/assets/css/cockpit.css`
- **Dev-Setup:** `cd apps/openape-troop && pnpm dev` (Port 3010) · Tests: `pnpm vitest run` · Gates: `pnpm lint && pnpm typecheck`
- **Agent-Auth für curl-Proben:** SP-Token via `bash ~/.config/openape-worker/cockpit-agent.sh heartbeat` erzeugen, dann `TOK=$(cat /tmp/cockpit-sp-<hash>.tok)`; gegen Dev-Server `Operator_SP_URL=http://localhost:3010`.

## Architektur-Entscheidungen (vorab fixiert)

1. **Neuer TaskState `input-required`** (in-memory; wird NIE als solcher persistiert — analog `deferred`→`submitted`+`notBefore` aus #989). Am `QueueTask` neu: `question?: string`, `options?: string[]` (max 4, je ≤80 Zeichen, serverseitig validiert).
2. **Frage erreicht Patrick auf zwei Wegen** (beide nötig):
   a. **Live:** SSE-Loop in `message.post.ts` behandelt `input-required` als weiches Terminal → `emit({k:'ask', text, options, taskId})`, dann break. (Lektion aus dem #989-Review: sonst hängt der Stream bis 240s-Timeout.)
   b. **Persistent (Reload/Push):** `saveChatMessage` mit neuer optionaler Spalte `meta TEXT` (JSON: `{taskId, options, answered?}`) auf `cockpit_chat_messages` — idempotente Migration wie in #989 (`ALTER TABLE … .catch(() => {})`). Web-Push feuert mit (bestehender Pfad in chat-store).
3. **Antwort-Endpoint:** `POST /api/cockpit/tasks/[id]/answer` `{choice: string}` — Owner-Session-Auth (`cockpitOwner`), validiert: Task existiert, `state === 'input-required'`, `task.owner === owner`, `choice` ∈ options ODER Freitext ≤500 Zeichen. Effekt: `userMessage += "\n\n[Rückfrage] <question>\n[Antwort] <choice>"`, Frage+Antwort als progress-Notes, `state='submitted'`, `claimed=false`, zurück in `pending`; Chat: user-Message mit choice speichern, `meta.answered=true` auf der Frage-Message. **Task weg (Restart+Prune):** 404 → Client fällt auf normalen `send()` zurück (Antwort wird neuer Task mit Fragen-Kontext im Text) — degradiert graceful, kein Dead-End.
4. **Persistenz über Restarts:** `StoredTask` + `cockpit_tasks` um `question TEXT`, `options TEXT` (JSON) erweitern; `resolve.post.ts` macht bei `input-required` ein `saveTask`-Update (mit Owner-Guard!, Muster #989); `restoreTask` stellt Frage-Zustand wieder her. Prune-Kriterium: Tasks in input-required leben 7 Tage (`max(createdAt, askedAt)`-Logik NICHT nötig — einfachster Schnitt: `notBefore`-Spalte doppelnutzen? NEIN, eigene Spalte `asked_at INTEGER`; Prune: `input-required`-Rows erst nach 7d).
5. **Worker-CLI:** `cockpit-agent.sh ask <id> "Frage" [opt1] [opt2] [opt3] [opt4]` → POST resolve `{state:'input-required', question, options}`. `COCKPIT_DIRECTIVE` in `worker.sh` bekommt: *„Fehlt dir eine Entscheidung des Owners, stell sie mit `ask` (max 4 Optionen) statt zu raten; heikle Aktionen (Deploy, Merge, Löschen, Senden) IMMER erst per ask freigeben lassen. Stammt der Task aus einem Issue/PR, schreibe die ausführliche Fassung der Frage zusätzlich als Kommentar DORT (durables Dokument) und halte die ask-Frage kurz mit Verweis (‚Details am Issue #n')."* — Eskalation rendert an der Herkunft des Tasks; ask ist das Pause/Resume+Notification-Primitive, nicht der Ort der Doku.
6. **UI:** `ChatMessage` um `ask?: {taskId, options, answered?}` erweitern. `CockpitBubble` rendert unter dem Fragetext Chips (Buttons); Tap → `POST …/answer`, Chips deaktivieren, user-Bubble mit choice anhängen, Stream-Reattach auf denselben Task (bestehendes `reattachProgress`). Nach Reload kommen Chips aus `meta` der persistierten Message.

## Milestones

### Milestone 1: Queue + API (server-only, curl-beweisbar)

**Ziel:** Ein Task kann per Agent-Resolve in `input-required` gehen und per Owner-Answer denselben Task fortsetzen — ohne UI, ohne Worker-Änderung.

**Schritte:**
1. `queue.ts`: `TaskState` + `'input-required'`; `QueueTask.question/options`; `resolve()`-Branch (state setzen, claimed=false, NICHT in pending); neue Fn `answerTask(id, owner, choice): boolean` (Validierung wie oben, Re-Enqueue); `claimNext` ignoriert `input-required` (nicht 'submitted' — greift schon).
2. `resolve.post.ts`: Validierung `question` (nicht leer, ≤500) + `options` (Array ≤4, Strings ≤80) bei `state==='input-required'`; Owner-Guard + `saveTask`-Update (Muster #989, inline-Guard!); `saveChatMessage(…, 'assistant', question, meta)` — chat-store um optionalen `meta`-Param + Spalte erweitern.
3. `task-store.ts` + `schema.ts`: Spalten `question`, `options`, `asked_at`; Prune: input-required-Rows 7d statt 30min; `restoreTask` inkl. Frage-Zustand.
4. Neu `server/api/cockpit/tasks/[id]/answer.post.ts` (Owner-Session; existierendes Muster `tasks/[id]/progress.get.ts` daneben).
5. `message.post.ts`: SSE-Branch `t.state === 'input-required'` → `emit({k:'ask', …})`, answered=true, break; `cleanup()` NICHT ausführen (Task lebt weiter). `messages.get.ts`: `meta` mitliefern.
6. Tests (`tests/cockpit-queue.test.ts` + neu `tests/cockpit-ask.test.ts`): ask→kein claimNext · answer(owner) → claimNext liefert Task mit angereichertem userMessage+progress · answer(fremder Owner) → false, unverändert · options-Validierung 400 · save/restore-Roundtrip mit Frage · answered-Frage nicht erneut beantwortbar.

**Akzeptanzkriterien:**
- [ ] `pnpm vitest run` → alle grün, inkl. neuer Datei
- [ ] Dev-Server: Task via `POST /api/cockpit/message` anlegen (messages-Array!), als Agent `POST /api/cockpit/agent/tasks/resolve` mit `{state:'input-required', question:'A oder B?', options:['A','B']}` → 200; `GET /api/cockpit/messages?company=…` enthält die Frage mit `meta.options`
- [ ] `POST /api/cockpit/tasks/<id>/answer {"choice":"A"}` (Owner-Session/Bearer) → 200; als Agent `POST …/next` → Task kommt mit `[Rückfrage]…[Antwort] A` im userMessage
- [ ] Antwort mit falschem Owner-Token → 403/404, Task unverändert

**Rollback:** Branch-Revert; Migration ist additiv (neue nullable Spalten), kein Down nötig.

### Milestone 2: Worker-CLI + Directive

**Ziel:** Der echte Operator kann fragen — `ask` existiert im CLI, die Directive fordert es für heikle Aktionen.

**Schritte:**
1. `public/worker/cockpit-agent.sh`: `ask <id> <frage> [opt…]`-Subcommand (JSON-Body via python3, Muster `resolve_body`); usage-Zeilen (beide!).
2. `public/worker/worker.sh`: Directive-Satz (Entscheidung 5); nach Deploy lokale Kopien nach `~/.config/openape-worker/` + `launchctl kickstart -k gui/501/at.openape.worker`.
3. `bash -n` beide Dateien.

**Akzeptanzkriterien:**
- [ ] Gegen Dev-Server: `Operator_SP_URL=http://localhost:3010 cockpit-agent.sh ask <id> "Deploy prod-x?" Ja Nein` → 200, Frage in messages
- [ ] Live-Probe nach Deploy: Cockpit-Frage an eine Firma, deren Antwort eine Owner-Entscheidung braucht (z. B. „Räum den Test-Branch xyz weg — frag mich vorher") → Operator stellt ask statt zu handeln

**Rollback:** worker-Dateien sind versioniert ausgeliefert; alte Kopien bleiben unter `~/.config/openape-worker/` bis zum cp.

### Milestone 3: UI — Chips im Chat (live + Reload)

**Ziel:** Frage erscheint als Bubble mit tappbaren Chips; Tap setzt denselben Task fort; nach Reload bleibt alles konsistent.

**Schritte:**
1. `app/utils/cockpit/types.ts`: `ChatMessage.ask?`; `useCockpitChat.ts`: SSE-Case `k:'ask'` (Bubble finalisieren mit ask-Feld), `answer(taskId, choice)`-Fn (POST, user-Bubble, `reattachProgress(taskId, …)`; 404 → Fallback `send()` mit Fragen-Kontext), Reload-Mapping `meta`→`ask`.
2. `CockpitBubble.vue`: Chip-Reihe unter dem Text (`message.ask && !message.ask.answered`); Emit `answer`; `CockpitChat.vue` verdrahtet.
3. `cockpit.css`: `.ask-chips` (flex-wrap, Pill-Buttons in `--accent`-Rahmen, disabled-State) — Mobile-tauglich (≥44px Tap-Target).
4. Screenshot-Beweis: Headless Chrome 390×844 (Frage mit Chips, beantworteter Zustand) via Dev-Server + gemockter Frage; per SendUserFile schicken.

**Akzeptanzkriterien:**
- [ ] `pnpm lint && pnpm typecheck` grün
- [ ] Browser-Probe (Dev): Frage-Task erzeugen → Chips sichtbar; Tap → user-Bubble mit Choice, Operator-Fortsetzung streamt in dieselbe Konversation; Reload → Frage als beantwortet (Chips disabled)
- [ ] Screenshot 390px an Patrick geschickt, bevor „fertig" behauptet wird

**Rollback:** UI-only-Commit, Revert genügt.

## Progress

- [x] `[2026-07-23 12:40]` Milestone 1: DONE — Commit de6cd235; alle 4 Akzeptanzkriterien per curl gegen Dev-Server bewiesen (Frage mit meta in messages, answer → selber Task mit [Rückfrage]/[Antwort], 404 bei unbekanntem Task)
- [x] `[2026-07-23 12:42]` Milestone 2: DONE — Commit bfd21aff; echtes CLI `ask` gegen Dev-Server verifiziert
- [x] `[2026-07-23 12:50]` Milestone 3: DONE — Chips live im Browser getappt, Task lief ÜBER SERVER-RESTART weiter (Rehydrate), Screenshot 390px an Patrick. PR #990, CI läuft.

## Surprises & Discoveries

- `2026-07-23` Die in-memory GC (`gcStaleTasks`, 30min-TTL) hätte offene Fragen gekillt, bevor ein Mensch abends antwortet — brauchte eigenes `ASK_TTL_MS` (7d), war im Plan nur für den DB-Prune bedacht.
- `2026-07-23` `COCKPIT_DEV_OWNER` (server/utils/cockpit/auth.ts) existiert genau für Browser-Tests ohne WebAuthn-Login — Dev-Server damit starten, Owner-Email muss die des apes-Tokens sein (patrick@hofmann.eco, nicht phofmann@).
- `2026-07-23` Headless-Chrome-Screenshots scheitern an IndexedDB+virtual-time (Seite bleibt leer); Playwright-core aus node_modules/.pnpm + System-Chrome (`executablePath`) mit `waitForSelector('.ask-chip')` funktioniert.
- `2026-07-23` Der Dev-Server-Restart mitten im UI-Test wurde unfreiwillig zum besten E2E-Beweis: Frage überlebte als cockpit_tasks-Row, kam per Rehydrate als input-required zurück und der Chip-Tap setzte sie fort.

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-07-23 | Gated Actions = Frage mit Ja/Nein, keine eigene Action-Semantik | Ein Primitive statt zwei; Operator führt die Aktion nach Freigabe selbst aus | Action-Objekte mit server-seitiger Ausführung (zu viel Vertrauen in v1) |
| 2026-07-23 | `input-required` nie persistiert als State — Spalten question/options/asked_at | Muster aus #989 (deferred→submitted+notBefore) hat sich bewährt; kein Enum-Migrationsrisiko | Persistierter State-Enum-Wert |
| 2026-07-23 | Antwort-Fallback bei totem Task: neuer Task mit Fragen-Kontext | Kein Dead-End für den Owner; degradiert graceful | Fehler anzeigen („Task abgelaufen") |
| 2026-07-23 | Chips zusätzlich zum normalen Eingabefeld, kein Freitext-Zwang | Composer bleibt immer benutzbar; „Other" ist einfach normale Nachricht | Modal/erzwungene Auswahl |
| 2026-07-23 | Eskalation rendert an der Task-Herkunft (Issue-/PR-Kommentar), Chat = Zeiger+Chips; Queue-Primitive bleibt transport-agnostisch | Patricks Einwand: Operator arbeitet Board/Issues — Doku gehört dorthin (Beleg: #983-Triage). answer-Endpoint erlaubt später Webhook-Antworten (Issue-Kommentar → answerTask via #971) | Alles nur im Chat (verliert Doku-Ort); alles nur am Issue (verliert Push+Ein-Tap-Antwort) |

## Session-Checkliste

1. Plan lesen, Progress prüfen · 2. `git log` seit letztem Commit · 3. `pnpm dev` + `pnpm vitest run` Baseline · 4. nächsten Milestone · 5. pro Milestone committen (Branch `feat/issue-981-input-required`, PR gegen main) · 6. E2E-Verifikation per curl/Browser wie oben · 7. Progress/Discoveries aktualisieren

## Outcomes & Retrospective

- **Ergebnis:** PR #990 merged (Issue #981 zu), deployed als `prod-7335f952`, lokaler Worker aktualisiert. Operator kann Rückfragen mit Chips stellen (`ask`), Antwort setzt denselben Task fort — inkl. Restart-Überleben (Rehydrate). Gated Actions laufen als Ja/Nein-Frage über dasselbe Primitive.
- **Abweichungen vom Plan:** Keine inhaltlichen. Zusätzlich nötig: `ASK_TTL_MS` für die in-memory GC (Plan hatte nur den DB-Prune bedacht). CI brauchte einen Re-Run wegen main-seitigem e2e-Flake (free-idp yolo-policy Boot-Timeout → Issue #991 ans Team).
- **Learnings:** (1) Bei „State pausiert auf Mensch"-Features immer BEIDE Lebensdauern prüfen — DB-Prune UND in-memory GC. (2) `COCKPIT_DEV_OWNER` + Playwright-core aus node_modules/.pnpm mit System-Chrome ist der zuverlässige UI-Beweis-Pfad (Headless-Chrome scheitert an IndexedDB+virtual-time). (3) Der unfreiwillige Dev-Server-Restart mitten im UI-Test war der wertvollste E2E-Beweis — Restart-Tests künftig absichtlich einplanen.
