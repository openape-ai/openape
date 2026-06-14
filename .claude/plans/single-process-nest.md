# Plan: Single-Process Nest — 26 Prozesse → 1

> Self-contained. Ein Agent/Mensch ohne Vorwissen muss das von oben nach unten
> umsetzen können. Stand: 2026-06-14. Vom Owner (Patrick) freigegebene Richtung
> ("1 Nest-Prozess").

## Purpose / Big Picture

- **Ziel:** Der Nest betreibt eine ganze Agent-Firma als **einen** Prozess. Kein
  pm2, keine per-Agent-Node-Prozesse mehr. „Bridge ist tot und kommt nicht
  zurück" verschwindet als Fehlerklasse. Für den Owner ändert sich nichts an der
  Bedienung — Agents bleiben in tasks/git.openape.ai sichtbar und reagieren —
  aber das System ist drastisch einfacher zu verstehen und robuster.
- **Kontext:** Heute = pro Agent 1 OS-User + 1 eigener pm2-Daemon + 1 Bridge-
  Node-Prozess + 1 Dauer-WS + 1 Cron-`setInterval`. Bei 13 Agents ~26 langlebige
  Prozesse. `max_restarts:10` ließ pm2 nach 10 Crashes endgültig aufgeben →
  gestrandete Agents (Sofort-Schutz #659 hebt den Cap, ersetzt das Modell aber
  nicht). Die Agent-Loop ist **schon** in-process aufrufbar (`runLoop` aus
  `@openape/apes`) — das Per-Prozess-Modell ist historisch, nicht notwendig.
- **Scope DRIN:** AgentSession-Extraktion, In-Process-SessionHost im Nest,
  per-Agent-Secret/Env-Isolation, Tool-Ausführung per `sudo -u <agent>`, Cutover
  + Entfernen von pm2. **NICHT drin:** Änderung am troop-Protokoll, an
  tasks/git.openape.ai, an Recipes/Personas, an der DDISA-Auth.

## Repo-Orientierung

- **Projekt:** openape-monorepo, `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Relevante Dateien:**
  - `apps/openape-ape-agent/src/bridge.ts` — heutige per-Agent-Bridge. `main()`
    (≈Z.434) → `readConfig()` → `startSecretsWatcher()` → `getIdentity()` →
    `new Bridge(...)` → `pumpOnce()`-Loop (Z.382: öffnet WS, behandelt
    Nachrichten, ruft `runLoop`). `CronRunner` (Z.198/217) tickt geplante Tasks.
  - `apps/openape-ape-agent/src/cron-runner.ts` — `CronRunner` (`setInterval`,
    `tick()`), scheduled `command`/LLM-Tasks.
  - `apps/openape-nest/src/lib/pm2-supervisor.ts` — `Pm2Supervisor.reconcile()`
    schreibt `/var/openape/agents/<name>/ecosystem.config.js` + `start.sh`, dann
    `sudo -u <agent> bash start.sh` → `pm2 startOrReload`. **Diese Datei wird in
    M4 gelöscht.**
  - `apps/openape-nest/src/index.ts` — Nest-Main: `new Pm2Supervisor(...)` (Z.37),
    `reconcile()` (Z.41) nur bei Registry-Änderung (fs.watch, Z.61; 5s-Poll-
    Fallback Z.75). Hier kommt der `SessionHost` rein.
  - `apps/openape-nest/src/lib/troop-ws.ts` — Nest↔troop. Enthält bereits
    `runAsAgent(name, cmd)` / `sudoAs(name, cmd)` (#657) — **das Muster für die
    Tool-Isolation in M3**.
  - `packages/apes/src/lib/agent-secrets-runtime.ts` — `materializeSecrets(opts)`
    (mutiert heute `process.env` ODER `opts.env`!) + `startSecretsWatcher`.
    `MaterializeOptions.env` existiert schon → **per-Agent-Env-Map ist bereits
    vorgesehen** (in Tests injiziert).
  - `packages/apes` exportiert `runLoop, taskTools, TOOLS, runApeShell` aus
    `@openape/agent-runtime` (siehe `packages/apes/src/index.ts` Z.51) — die
    Loop ist in-process nutzbar.
- **Tech-Stack:** Node ≥22, TypeScript, tsup-Builds, pnpm + turbo, h3, ws, jose.
- **Dev-Setup:**
  - Lint/Typecheck: `pnpm turbo run lint typecheck --filter=@openape/nest --filter=@openape/ape-agent`
  - Nest-Image bauen: `docker build -f apps/openape-nest/Dockerfile -t openape-nest:hardened .`
  - Laufender Nest: Container `openape-nest` (raw `docker run`, KEIN compose).
    Exakte Run-Config in Memory `project_org_agent_company.md` (Abschnitt
    „DURABLE NEST IMAGE"). Recreate-Rezept dort, ist bewiesen sauber (Volumes
    `compose_openape-homes` + `compose_openape-nest-data` persistieren alles).
  - Health: `docker exec openape-nest sh -c 'ps aux | grep -c "[a]pe-agent"'`
    (heute 13); LLM `curl http://openape-llm:4000/v1/models` → 200.

## Architektur: Vorher → Nachher

**Vorher (pro Agent, ×13):** OS-User + pm2-Daemon + Bridge-Prozess + WS + Cron.
Tools laufen nativ als der Agent-User (Bridge wurde via `sudo -u` gestartet).
Secrets in `process.env` des Bridge-Prozesses.

**Nachher (1 Nest-Prozess):** `SessionHost` hält N `AgentSession`-Objekte
in-process. Jede Session: eigene Identity/Token, eigene WS (N billige Sockets in
1 Prozess — Multiplexing NICHT nötig), eigener Secret-**Env-Map** (nicht global!),
eigene Schedule (ein zentraler Tick iteriert alle Sessions). LLM-Orchestrierung +
WS + Token laufen im Nest (root). **Nur seiteneffekt-behaftete Tool-Calls
(bash/file) droppen per `sudo -u <agent>` mit der Agent-Env-Map** → Isolation
bleibt erhalten, jetzt zur Tool-Zeit statt zur Prozess-Zeit. Die OS-User bleiben
(für den sudo-Drop); nur pm2 + die per-Agent-Node-Prozesse fallen weg.

**Crash-Verhalten:** Per-Session-Fehler werden in-process gefangen + retried
(wie `pumpOnce` heute schon). Nur ein prozess-fataler Bug nimmt alle mit — selten,
und der Container `restart:unless-stopped` fängt ihn. Netto robuster als 13 pm2.

## Milestones

### Milestone 0 (Prototype/Spike): Isolation-in-1-Prozess de-risken

**Ziel:** Beweisen, dass ein Prozess mehrere Agents hosten kann, **ohne** dass
Agent A das Secret/Home von Agent B sieht — der zentrale Risikopunkt.

**Vorgehen:**
1. Mini-Harness `apps/openape-nest/scripts/spike-isolation.mjs`: ein Node-Prozess,
   2 Agent-IDs (z.B. `backend`, `qa`). Für jeden:
   - `materializeSecrets({ env: perAgentEnvMap, keyPath, dir })` → Env-Map statt
     `process.env` (das `env:`-Feld existiert bereits).
   - Tool simulieren: `sudo -n -H -u <agent> env` mit der Agent-Env-Map als
     `env:` des Child-Prozesses (NICHT `process.env`).
2. Assert: backends `env` enthält `FORGEJO_TOKEN` von backend, qas NICHT; und
   umgekehrt. Plus: backend kann `qa`s `~/.config/openape/secrets.d` NICHT lesen.
3. Zweiter WS-Check: 2 WS-Verbindungen (je eigener Agent-Token) gleichzeitig in
   einem Prozess zu troop öffnen, je eine Test-Nachricht empfangen, korrekt der
   Session zuordnen.

**Akzeptanzkriterien:**
- [ ] `node apps/openape-nest/scripts/spike-isolation.mjs` → Output zeigt
  `backend: FORGEJO_TOKEN=<set>, sees-qa-secret=NO` und `qa: FORGEJO_TOKEN=<set>,
  sees-backend-secret=NO`.
- [ ] 2 gleichzeitige WS verbinden + routen Nachrichten korrekt (Log zeigt
  `msg for backend -> session backend`, nie cross).

**Ergebnis:** Bestätigtes Env-Injection-Muster (Map statt `process.env`) + bewiesen,
dass N WS in 1 Prozess gehen. **Rollback:** Spike-Script löschen, keine Prod-Wirkung.

### Milestone 1: `AgentSession` extrahieren (kein Verhaltenswechsel)

**Ziel:** Die per-Agent-Logik aus `bridge.ts` in eine wiederverwendbare,
prozess-global-freie Klasse `AgentSession` ziehen — die bestehende Bridge nutzt
sie intern weiter, nichts ändert sich am Laufzeitverhalten.

**Schritte:**
1. Neu: `apps/openape-ape-agent/src/agent-session.ts` — `class AgentSession`
   kapselt: Identity/Token-Refresh, `secretsEnv` (Map, via
   `materializeSecrets({ env })`), WS-Loop (`pumpOnce`-Logik), `CronRunner`.
   Konstruktor nimmt `AgentConfig` + Callbacks; **kein** `process.env`-Schreiben.
2. `bridge.ts main()` wird dünn: baut EINE `AgentSession` aus `readConfig()` und
   `session.run()`. `startSecretsWatcher` wandert in die Session (schreibt jetzt
   `session.secretsEnv` statt `process.env` — Single-Agent-Prozess, daher
   verhaltensgleich).
3. Tool-Runner in `agent-runtime`: dort wo bash/file-Tools Child-Prozesse
   spawnen, `env` = `session.secretsEnv` durchreichen (statt impliziert
   `process.env`). Im Single-Agent-Fall identisch.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run lint typecheck test --filter=@openape/ape-agent` grün.
- [ ] Image bauen + Container recreaten (Rezept aus Memory) → 13 Bridges,
  Secret-Pfad (`materializeSecrets` als User backend → `applied:["FORGEJO_TOKEN"]`)
  funktioniert wie vorher.

**Rollback:** PR reverten — die Bridge lief vorher mit derselben Logik inline.

### Milestone 2: `SessionHost` im Nest (Feature-Flag, neben pm2)

**Ziel:** Der Nest kann N `AgentSession` in-process fahren, gesteuert per Flag
`OPENAPE_NEST_INPROCESS=1`. Ohne Flag bleibt pm2 aktiv (Sicherheitsnetz).

**Schritte:**
1. Neu: `apps/openape-nest/src/lib/session-host.ts` — `class SessionHost`:
   `reconcile(desired: AgentEntry[])` legt fehlende Sessions an / stoppt
   entfernte; hält `Map<name, AgentSession>`. Ein zentraler Scheduler-Tick
   iteriert Sessions (ersetzt 13 `setInterval`).
2. `apps/openape-nest/src/index.ts`: wenn `OPENAPE_NEST_INPROCESS=1` →
   `new SessionHost(...)` statt `new Pm2Supervisor(...)`; `reconcile()` ruft den
   Host. fs.watch/Poll bleibt (Registry-Änderungen → Host.reconcile).
3. Jede Session-Loop in try/catch mit Reconnect-Backoff (wie `pumpOnce`).

**Akzeptanzkriterien:**
- [ ] Container mit `-e OPENAPE_NEST_INPROCESS=1` recreaten → `ps aux` zeigt
  **1** Node-Prozess (der Nest), **kein** `ape-agent`/`pm2` mehr.
- [ ] Alle 13 Agents in der Registry → reagieren auf eine Test-Nachricht via troop
  + führen einen scheduled Task aus (Log zeigt pro Agent Aktivität).
- [ ] Ohne Flag: altes pm2-Verhalten unverändert.

**Rollback:** Flag weglassen → pm2-Pfad. PR bleibt mergebar, da flag-gated.

### Milestone 3: Tool-Isolation per `sudo -u <agent>` härten + adversarial test

**Ziel:** Jeder seiteneffekt-behaftete Tool-Call (bash/file/shell) läuft als der
Agent-OS-User mit dessen Env-Map — nie als root, nie mit fremder Env.

**Schritte:**
1. Im in-process Tool-Pfad: bash/file-Tools über `sudoAs(name, cmd)`
   (`troop-ws.ts`-Muster, #657) mit `env: session.secretsEnv` ausführen.
   Read-only/LLM-interne Tools (http/time) brauchen keinen Drop.
2. Adversarial-Test `apps/openape-nest/test/isolation.test.ts`: Session A führt
   `cat /var/lib/openape/homes/<B>/.config/openape/secrets.d/*` aus → muss
   „Permission denied" sein; A's `env`-Tool zeigt A's, nie B's `FORGEJO_TOKEN`.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter=@openape/nest` — Isolations-Test grün.
- [ ] Live-Probe: zwei Agents je ein bash-Tool `echo $FORGEJO_TOKEN | sha256sum`
  → unterschiedliche Hashes; Cross-Read auf fremdes Home schlägt fehl.

**Rollback:** PR reverten (M2-Host bleibt, nur Tool-Drop strenger/lockerer).

### Milestone 4: Cutover — In-Process default, pm2 entfernen

**Ziel:** `OPENAPE_NEST_INPROCESS` default an; pm2 + per-Agent-Generierung weg.

**Schritte:**
1. Default umstellen (Flag entfernt oder default=1).
2. **Löschen:** `apps/openape-nest/src/lib/pm2-supervisor.ts` + Referenzen;
   `RUN npm install -g pm2` aus `apps/openape-nest/Dockerfile`; per-Agent
   ecosystem/start.sh-Generierung.
3. `docker-entrypoint.sh`: OS-User-Recreate aus Registry BLEIBT (für sudo-Drop);
   pm2-Bezüge raus.
4. Memory + `compose/README.md` aktualisieren.

**Akzeptanzkriterien:**
- [ ] Frischer Recreate → `ps` zeigt 1 Prozess, 13 Agents live, Secret-Pfad ok,
  `command -v pm2` → leer, kein `/var/openape/agents/*/ecosystem.config.js`.
- [ ] Prozess-Zahl 26 → 1 belegt (`ps aux | wc -l` vorher/nachher).
- [ ] Eine Bridge gezielt „crashen" (Session-Throw injizieren) → in-process
  gefangen + reconnected, kein gestrandeter Agent.

**Rollback:** Revert des Cutover-PRs → flag-gated M2-Zustand (pm2 noch im Image
solange Dockerfile-Revert mitgeht). Rollback-Container `openape-nest-prev` (siehe
Memory) als letzte Instanz.

## Progress

- [x] `[2026-06-14]` M0 Spike — **GRÜN**. Isolation hält in 1 Prozess; Design
  vereinfacht (Nest hält KEINE Secret-Maps; Agent self-materialisiert beim Tool-Call).
- [x] M1 AgentSession — DONE via Agent (#661 Skelett, #663 secretsEnv, #665 bridge nutzt describe)
- [~] M2 SessionHost (flag) — LÄUFT, ich fahre: #666 Scaffold+Flag OPENAPE_NEST_INPROCESS gemerged; #667 reconcile() trackt Lifecycle-Map; #668 GEMERGED = HostedSession start/stop-Seam (injizierbare SessionFactory, Placeholder=no-op); #669 GEMERGED (a0f60929, CI grün) = zentraler Scheduler-Tick-Seam (HostedSession.tick + SessionHost.tickAll(), ersetzt 13 setInterval; per-Session try/catch-Isolation; Placeholder ohne tick = no-op) — 9 session-host-Tests; #670 GEMERGED (c890925c, CI grün) = zentraler Scheduler-Tick in index.ts verdrahtet (setInterval ruft sessionHost.tickAll(), nur bei OPENAPE_NEST_INPROCESS=1; Cadence 60s = cron-runner-Default, override via OPENAPE_NEST_TICK_MS; Timer unref'd + auf SIGTERM/SIGINT geclbeared; non-breaking weil Placeholder-Sessions kein tick() haben → no-op); #672 GEMERGED (984c7a1e, CI grün) = SessionHost.stopAll() + graceful shutdown in index.ts (SIGTERM/SIGINT stoppen alle live Sessions vor exit statt nur Timer zu clearen; per-Session try/catch, Map geleert → kein Doppel-Stop; non-breaking, Placeholder-stop=no-op, pm2-Pfad unverändert weil sessionHost undefined) — 12 session-host-Tests (+3). #673 GEMERGED (squash, CI grün) = reconcile restartet Session bei Config-Change (same-name, geänderte AgentEntry → stop alt + start neu aus neuem Entry; registeredAt ausgenommen; Log `~ <name> (config changed, restarted)`; schließt Parität-Lücke zum pm2-`startOrReload` bei Model-Swap/Key-Rotation; sessions-Map hält jetzt {session,entry}; non-breaking, Placeholder-restart=no-op) — 15 session-host-Tests (+3). #674 GEMERGED (2cf18810, squash, CI grün) = reconcile isoliert per-Session start/stop/restart-Fehler in eigenem try/catch (vorher: einziger SessionHost-Pfad OHNE Isolation — ein werfender start()/stop() brach den ganzen reconcile ab und strandete alle übrigen Agents; jetzt Parität zu tickAll/stopAll); failed start/restart → Agent bleibt absent aus live-Map → nächster reconcile retried; Agent weg aus Registry → gedroppt auch wenn stop() wirft; errText()-Helper extrahiert (3. Nutzung); non-breaking, Placeholder wirft nie — 18 session-host-Tests (+3 Isolations-Tests). #675 GEMERGED (1480e08e, squash, CI grün) = reconcile gegen sich selbst serialisiert (Coalescing-Guard `reconciling`/`pendingDesired`): index.ts triggert reconcile aus 3 Quellen (initial, debounced fs.watch, 5s-Poll) → können sich überlappen, sobald start() einen echten WS-Socket öffnet; die live-Map wird erst NACH `await session.start()` geschrieben → zwei parallele Läufe sähen denselben Agent in toStart und starteten ihn doppelt. Jetzt: ein reconcile zur Zeit, ein mid-run-Request wird gemerkt (latest desired wins, declarative) + nach Drain einmal repaayed; alte reconcile-Body → private `reconcileOnce`; non-breaking (nur INPROCESS-Pfad, Placeholder-start=no-op) — 21 session-host-Tests (+3 Serialisierungs-Tests), 50 nest-Tests total. #676 GEMERGED (c897d35f, squash, CI grün) = zentraler Tick retried einen gestrandeten Session-Start: bisher wurde ein werfender `start()` NUR beim nächsten reconcile retried (feuert allein bei Registry-Änderung) → sobald Sessions echte WS öffnen, würde ein transienter Start-Fehler den Agent bis zur nächsten Registry-Edit stranden lassen. Jetzt prüft `tickAll()` vor dem Advance, ob ein *desired* Agent nicht live ist, und routet den Retry zurück durch das bereits-serialisierte, idempotente `reconcile` (wiederverwendet den Coalescing-Guard → ein Tick während eines laufenden reconcile kann denselben Agent nie doppelt starten) — in-process Parallele zu pm2-autorestart. `desired`-Map wird in reconcileOnce mitgeführt. Non-breaking: Placeholder-`start()` wirft nie → jeder desired Agent ist schon live → Retry-Pfad = no-op; nur INPROCESS-Pfad — 24 session-host-Tests (+3), 53 nest-Tests total. #678 GEMERGED (squash, delete_branch, CI grün) = reconcile droppt stale Session bei fehlgeschlagenem Restart: bei Config-Change stoppte reconcile die alte Session und startete eine neue; warf `start()`, blieb die alte (bereits gestoppte) LiveSession in der Map → `tickAll`-Retry-Guard sah den Agent als present, retriete ihn nie, und die tote Session würde weiter geticked — bis zum nächsten Registry-Edit. Jeder andere Pfad (start/stop) lässt einen gescheiterten Agent schon *absent* → wird retried; Restart war der inkonsistente Fall. Fix: stale Session vorab aus der live-Map löschen → bei Erfolg re-added startSession sie mit neuem Entry, bei jedem Fehler ist der Agent absent → tickAll/nächster reconcile starten ihn frisch. Non-breaking (Placeholder wirft nie) — 26 session-host-Tests (+2), 55 nest-Tests total. **Engine-Regel: nur mergen wenn CI grün; bei rot offen lassen.** [2026-06-14] PR #677 (werkstatt-scribe, AgentSession describe/secretsEnv-Tests): CI ROT auf typecheck (NICHT der vermutete spyOn-named-import-Gotcha — Test+Lint grün, nur `tsc` rot), lokal reproduziert: `mockImplementation(({ env }) => ({ applied, env }))` → MaterializeResult verlangt zusätzlich `failed`, und der Param ist `opts?` (kann undefined). Review-Kommentar mit exaktem Fix gepostet (Comment auf #677), NICHT gemergt. [2026-06-14] 3 idle Coding-Agents getasked (Team 01KV0XTPETENZ42S5GE6GRPGDG, disjunkte Packages, kein nest/src/lib): backend→cli-auth Coverage (01KV3QDTZ2), qa→core Edge-Cases (01KV3QDV8F), scribe→server/README (01KV3QDVHJ). Nächste Inkremente = per-Agent Runtime-Loop hinter dem Seam (start/tick echt implementieren — der grosse Schritt; alle Lifecycle-Seams sind jetzt fertig) + sudo-drop Tool-Isolation. (Backend-Agent-Task 01KV3GPRS4 = TICK_MS-NaN-Guard → PR #671: CI grün ABER mangelhaft, [2026-06-14] Review-Kommentar #721 = Änderungen erforderlich: (a) echten Call-Site `index.ts:37 TICK_INTERVAL_MS = Number(...)` fixen statt verworfenem Standalone-Call — Bug bleibt sonst; (b) troop-sync.ts-Kopplung an OPENAPE_NEST_TICK_MS zurücknehmen (5min-Default-Regression); (c) agent-session.secretsEnv()-Scope-Creep raus; (d) rebasen — mergeable=false. tick-ms.ts-Helper+Tests sind gut. NICHT gemergt.) #679 GEMERGED (7890a3c9, squash, delete_branch, CI grün) = SessionHost.status() read-only Introspektion: liefert sortierte `{ desired, hosted, stranded }`-Listen (stranded = desired Agents, deren start() noch nicht erfolgreich war). Pure Beobachtung, mutiert nichts, kein Verhaltenswechsel — die Cutover-Health-Surface + M2-Akzeptanz ("alle 13 Agents live") lesen das, um einen gesunden Host von einem mit steckengebliebenen Starts zu unterscheiden. Flag-Pfad + Placeholder unverändert — 30 session-host-Tests (+4). [2026-06-14] PR #677-Reanimation: scribe-Agent hat Fix-Versuch gepusht (922c2c9), CI WEITER ROT auf typecheck — `mockImplementation(({ env }) => ({ applied:[...], env }))` schlägt zweifach fehl: `failed` fehlt im MaterializeResult-Return UND `({ env })` destrukturiert einen `opts?`-Param, der undefined sein kann (TS2345 + TS2339). 2. Review-Kommentar mit copy-paste-fertigem Fix (`(opts) => { if (opts?.env) ...; return { applied, failed: [] } }`) gepostet, NICHT gemergt. Agent-Backlog (cli-auth/core/server-README) alle in `doing`, disjunkt von nest/src/lib → kein neuer Task nötig. #680 GEMERGED (be4c5fb2, squash, delete_branch, CI+e2e+preview grün) = `tickAll` loggt gestrandete Agents namentlich VOR dem Retry (`session-host: N agent(s) stranded, retrying: <names>`): der Tick-Retry war bisher stumm → ein Agent mit dauerhaft fehlschlagendem `start()` tauchte nirgends im Nest-Log auf (einziges Signal war `status().stranded`, das noch nichts konsumiert). Genau das beobachtet die Cutover-Health-Surface („alle 13 live"). Non-breaking: Placeholder-`start()` wirft nie → nie gestrandet → Log feuert nie bis der echte Runtime-Loop landet; pm2-Pfad unverändert — 32 session-host-Tests (+2: loggt namentlich / schweigt wenn alle live), 61 nest-Tests total. [2026-06-14] scribe war idle (server/README-Task 01KV3QDVHJ done) → neuer disjunkter Doku-Task 01KV3S7SZ8 = README für packages/prompt-injection-detector (hat keine), NUR dieses Package, disjunkt von cli-auth/core/nest. backend (cli-auth 01KV3QDTZ2) + qa (core 01KV3QDV8F) weiter in `doing`. Nächster grosser Schritt bleibt: per-Agent Runtime-Loop hinter dem Seam echt implementieren (start/tick) — NICHT autonom ohne E2E/Patrick. [2026-06-14] PR #681 (werkstatt-scribe, prompt-injection-detector README) STRENG reviewt: alle Exports gegen src/index.ts, Thresholds 0.7/0.95 gegen types.ts, decide()/DecisionResult gegen detector.ts, BEIDE worked-examples (score:1 / instruction-override, prompt-extraction; blocked:true/threshold:0.7) durch heuristic.ts getraced — exakt korrekt. Approved + GEMERGED (squash, delete_branch, CI grün). #682 GEMERGED (cf0c2572, squash, delete_branch, CI+e2e+preview grün) = `tickAll` loggt den stranded-Set NUR bei Änderung: der Tick-Retry feuert jede Cadence (60s), loggte aber bisher dieselbe `N agent(s) stranded, retrying: <names>`-Zeile bei JEDEM Tick → ein Agent mit dauerhaft fehlschlagendem start() würde das Nest-Log jede Minute mit identischer Zeile zumüllen. Jetzt: stabiler sortierter Key des stranded-Sets, Log nur wenn Key sich ändert (Retry läuft weiter jeden Tick); Key auf undefined zurückgesetzt sobald nichts stranded ist → erneutes Stranden desselben Sets loggt wieder. Non-breaking: Placeholder-start() wirft nie → nie stranded → Zeile feuert nie bis der echte Runtime-Loop landet; pm2-Pfad unverändert — 35 session-host-Tests (+3: loggt einmal solange unverändert / loggt erneut bei Änderung / loggt denselben Set erneut nach zwischenzeitlichem Clear), 64 nest-Tests total. [2026-06-14] Alle 3 Coding-Agent-Tasks (cli-auth/core/prompt-injection-detector) waren DONE → Team 01KV0XTPETENZ42S5GE6GRPGDG hatte 0 open/doing. 3 neue disjunkte Tasks angelegt (volle Package-Trennung, keiner in apps/openape-nest/src/lib/): backend→packages/grants Tests (01KV3TFX81, 12 src/0 Tests), qa→packages/proxy Edge-Case-Tests (01KV3TG2TH, 14 src/0 Tests), scribe→packages/browser README (01KV3TG93J, fehlt). #683 GEMERGED (d7d38a4a, latest main) = SessionHost.status() meldet zusätzlich `errored` (hosted Agents, deren letzter tick() warf; gecleart beim nächsten erfolgreichen tick) — schließt eine Cutover-Health-Blindstelle: bisher unterschied status() nur present/absent, ein Agent mit erfolgreichem start() (WS verbunden) aber dauernd werfendem tick las als gesund. LiveSession.tickFailed (set im catch / clear im try von tickAll), status().errored = sortierte Teilmenge von hosted. Non-breaking: Placeholder hat kein tick() → errored bleibt leer bis der echte Runtime-Loop landet — 66 nest-Tests (+2). NICHT gemergt solange CI nicht grün. [2026-06-14] Agent-Backlog: backend (grants 01KV3TFX81) + qa (proxy 01KV3TG2TH) = open, haben Arbeit. scribe browser-README (01KV3TG93J) = BLOCKIERT + an patrick@hofmann.eco zurück-assigned → scribe idle → neuer disjunkter Task 01KV3VFFC2 = README packages/idp-test-suite. **OWNER-DECISION offen (Patrick): lokaler pre-push-audit-Gate blockt JEDEN Push (auch docs-only) auf vorbestehender repo-weiter esbuild-Advisory GHSA-gv7w-rqvm-qjhr (high) → trifft alle 3 Agents, sobald sie ihren PR pushen wollen. Gate entweder für unrelated/docs-PRs lockern oder esbuild-Findings remediaten.**
- [~] **[2026-06-14] M2 REAL-RUNTIME-STRANG GESTARTET (Stopp dem Supervisor-Polieren):** PR #684 OFFEN (CI lief beim Run-Ende) = `@openape/ape-agent` als Library nutzbar gemacht + erste echte HostedSession-Factory. War bin-only (kein `exports`/lib-entry) → der Nest konnte den Agent-Runtime gar nicht in-process referenzieren = die echte Blockade vor der realen Session, NICHT der Supervisor. Änderungen: (a) `apps/openape-ape-agent/src/index.ts` exportiert `AgentSession` + `BridgeConfig`-Type; (b) tsup in ZWEI Configs gesplittet — bins behalten Shebang-Banner, die Library-`index.mjs` bekommt KEINEN Shebang (`#!` mitten im Bundle bricht Downstream-Bundler wie vitest/rolldown — GENAU dieser Fehler trat erst auf, Fix bewiesen) + `dts:true`; package.json `exports`/`main`/`types`. (c) `@openape/nest` bekommt workspace-dep auf `@openape/ape-agent`; (d) neu `apps/openape-nest/src/lib/agent-runtime-session.ts` `createAgentRuntimeSession()` = ECHTE (non-placeholder) HostedSession, die auf `start()` eine `AgentSession` ÜBER DIE PACKAGE-GRENZE konstruiert + describe() loggt. Injectable via `SessionHost.createSession`; Default bleibt Placeholder, index.ts unangetastet → INPROCESS-Flag-Pfad + pm2-Pfad verhaltensgleich. lint+typecheck+test grün (3 neue nest-Tests: Konstruktion / stop-Log / SessionHost-Injektion, 69 nest-Tests). NÄCHSTE Inkremente hinter DEMSELBEN Seam: BridgeConfig+ownerEmail aus Nest-Env ableiten (wie pm2 CHAT_ENV_FORWARDS) → WS öffnen → runLoop fahren → Tools per sudo-drop. **Etappensieg-Ziel (an Patrick melden): unter OPENAPE_NEST_INPROCESS=1 fährt EINE echte Session 1 Agent.** #685 GEMERGED (8f255824, squash, delete_branch, CI+e2e+preview grün) = BridgeConfig-Auflösung pro Agent: (a) `readConfig`+`BridgeConfig`-Interface in NEUES side-effect-freies `apps/openape-ape-agent/src/bridge-config.ts` extrahiert — **Root-Cause-Fund:** sobald `index.ts` einen *Value* (`readConfig`) aus `bridge.ts` re-exportiert (statt nur den type), zieht der Library-Bundle den Top-Level `main().catch()` von bridge.ts mit rein → vitest fing `process.exit(1)` als unhandled rejection (der #684-Library-Split hatte das latent — type-only-Export verbarg es). Fix bewiesen: `grep -c process.exit dist/index.mjs` = 0 nach Split. (b) `readConfig(env = process.env)` jetzt env-injectable (bin-Pfad via Default-Arg unverändert). (c) neu `apps/openape-nest/src/lib/bridge-config.ts` `resolveBridgeConfig(entry, env)` = per-Agent `registry.bridge.model`-Override über das geteilte `APE_CHAT_BRIDGE_MODEL` (Parität zum pm2-`APE_SERVICE_MODEL`), reused den Bridge-Parser (keine 2. Kopie der Regeln). Non-breaking: reiner Helper, NICHT in index.ts verdrahtet → INPROCESS-Flag-Pfad + pm2 unverändert — +4 nest-Tests (bridge-config), ape-agent-Lib-Entry verifiziert frei von main()/process.exit, 48 ape-agent-Tests. NÄCHSTER Schritt: ownerEmail pro Agent auflösen (aus dem Per-Agent-Identity-File `readAgentIdentity` im Agent-Home) → AgentRuntimeContext komplett → dann WS öffnen. #687 GEMERGED (5b7bad6d, squash, delete_branch, CI grün) = **AgentRuntimeContext komplett auflösbar**: (a) `readAgentIdentity(home = homedir())` home-injizierbar gemacht (Default = Prozess-Home → bin-Pfad byte-gleich; `authPath(home)` statt `homedir()` hart) → der EINE Nest-Daemon liest jetzt jedes gehostete Agent-Identity aus DESSEN `home` (registry `AgentEntry.home`), statt aus seinem eigenen. (b) `readAgentIdentity`+`AgentIdentity` aus dem `@openape/ape-agent`-Library-Entry exportiert; Lib-Bundle re-verifiziert frei von Shebang (`head -c2`=`va`) + `process.exit` (=0) — der #685-Gotcha hält (identity.ts ist side-effect-frei). (c) neu `resolveAgentRuntimeContext(entry, env)` in agent-runtime-session.ts: ownerEmail aus `<home>/.config/apes/auth.json` über den Bridge-eigenen Parser (keine 2. Kopie der auth.json-Regeln/Fallback), bridgeConfig aus Nest-Env via `resolveBridgeConfig`. Pure Resolver (liest Files, mutiert nichts), NICHT in index.ts verdrahtet → INPROCESS-Flag + pm2 unverändert. +3 nest-Tests (own-home-Auflösung / per-Agent-Distinktheit / Throw bei fehlendem Identity-File), 76 nest-Tests, identity-Tests unverändert (48 ape-agent). **NÄCHSTER Schritt: WS öffnen** — `createAgentRuntimeSession.start()` baut den Context via `resolveAgentRuntimeContext` und öffnet die troop-WS (Muster: bridge.ts `pumpOnce`), erst loggen/verbinden, dann runLoop. #691 GEMERGED (squash, delete_branch, CI+e2e+preview grün) = **HostedSession behält die AgentSession als Feld + idempotentes start/stop**: `start()` konstruierte die AgentSession und verwarf sie nach dem describe()-Log (agent-runtime-session.ts:63) — der Architekt-Fund. Jetzt in der Closure gehalten (`let session`), `stop()` reisst genau diese Instanz ab (loggt `- <name> stopped <describe>` → beweist Retention der konstruierten Instanz, nicht Neukonstruktion). Beide Enden idempotent gegen die gehaltene Instanz: zweites `start()` während Hosting = no-op (kein Doppel-Konstrukt; sobald WS landet kein Doppel-Open), `stop()` reisst nur ab was es hält (kein Doppel-Close eines Sockets). Genau die Eigenschaft, die der WS-Inkrement braucht — passt zur serialized-reconcile + stranded-start-tick-Retry des SessionHost, der `start()` sonst erneut rufen kann bevor der WS oben ist. Non-breaking: hinter dem injectable createSession-Seam, Default = Placeholder, INPROCESS-Flag + pm2 unverändert. +2 nest-Tests (Retention+Teardown / stop-no-op-ohne-start / start+stop-Idempotenz), agent-runtime-session-Datei jetzt 8 Tests, **78 nest-Tests total**. NÄCHSTER Schritt UNVERÄNDERT: in `start()` `resolveAgentRuntimeContext` aufrufen + troop-WS auf der gehaltenen Session öffnen, `stop()` schliesst sie. #696 GEMERGED (69dfcdc6, squash, delete_branch, CI+e2e grün) = **`AgentSession.chatSocketUrl(bearer)`** — pure Methode auf der gehaltenen AgentSession, die die troop-Chat-WS-URL exakt so ableitet wie die per-Agent-Bridge in `pumpOnce` (bridge.ts:339): `http→ws`, Token als Query-Param, `Bearer `-Prefix gestrippt, URL-encoded. Das ist der kanonische Wohnort der URL-Regel, sobald der Nest die Verbindung auf der retained AgentSession fährt → der WS-open-Inkrement öffnet denselben Socket OHNE zweite Kopie der Regel. Non-breaking: reine Methode, noch kein Caller; INPROCESS-Flag + pm2 unverändert; Lib-Entry re-verifiziert frei von Shebang (`head -c2`=`va`) + `process.exit`(=0). +3 ape-agent-Tests (https→wss / http→ws / Bearer-strip+encode), agent-session.test.ts jetzt 6 Tests, 51 ape-agent-Tests. **NÄCHSTER Schritt: in `createAgentRuntimeSession.start()` den Context via `resolveAgentRuntimeContext` bauen, einen Bearer beschaffen, `session.chatSocketUrl(bearer)` öffnen (ws-`open`/`message`/`close`-Handler wie pumpOnce) — DAS ist der E2E/Patrick-Gate-Etappensieg (1 Prozess, 1 echte Session, 1 Agent verbunden); NICHT autonom mergen ohne Live-Test gegen troop.**
  - **[2026-06-14] AGENT-BLOCKER eskaliert (OWNER-DECISION, Patrick):** Team 01KV0XTPETENZ42S5GE6GRPGDG hat 3 Tasks alle `doing` — backend (grants-Tests) arbeitet; qa (proxy-Edge-Tests: **5 Tests fertig + lokal verifiziert grün, commit 111ddbd7**) UND scribe (idp-test-suite README) sind **fertig aber zurück-assigned an patrick@hofmann.eco** weil der pre-push-Gate (`pnpm audit --prod --audit-level=high`, repo-weit) auf der VORBESTEHENDEN esbuild-Advisory `GHSA-gv7w-rqvm-qjhr` (high) JEDEN Push blockt — auch tests-/docs-only. Effektiv 2 von 3 Agents geparkt. KEINE neuen Tasks angelegt (würden nur weitere un-pushbare lokale Commits erzeugen). Engine hat den Gate NICHT autonom geschwächt (Security-Gate-Lockerung = Owner-Decision). **Patrick muss entscheiden:** Gate für unrelated/tests/docs-PRs lockern ODER esbuild via pnpm-override auf gepatchte Version remediaten. Siehe Memory [[werkstatt-prepush-audit-gate]]. **[2026-06-14] GELÖST von Patrick: PR #686 (150a396a) fügt `GHSA-gv7w-rqvm-qjhr` zu `package.json auditConfig.ignoreGhsas` → pre-push-Gate passiert wieder.** Engine-Folge: qa-Proxy-Task (01KV3TG2TH, fertig, commit 111ddbd7 auf branch test/proxy-edge-cases-qa) an qa zurück-assigned MIT Rebase-Hinweis (Branch ist VOR #686 geschnitten → package.json hat den Ignore noch nicht → `git rebase origin/main` PFLICHT vor push, sonst blockt der Gate weiter); idle scribe neuer disjunkter Task 01KV3Z6D5Q = README packages/shapes (NICHT nest/src/lib, NICHT ape-agent/src, NICHT grants/proxy). backend grants-Tests (01KV3TFX81) weiter doing. **[2026-06-14 später] scribe-shapes-README als PR #689 geliefert + STRENG reviewt** (jeder Export gegen src/index.ts; adapter-Suchpfade cwd/~/etc, registry-cache `~/.openape/shapes/cache/registry.json`+1h-TTL, generic-Konstanten `_generic.exec`/risk high/exact_command true, auth-Pfad `~/.config/apes/auth.json`, alle Signaturen async resolveCommand / sync resolveCapabilityRequest→{details,permissions,summary} / builders→{request} zur Quelle getraced — exakt korrekt, klingt wie Produkt-Docs) → approved + GEMERGED (squash). Eigene Docs-PRs #688 (plan #687) + #690 (ADR 0001) ebenfalls GEMERGED (CI grün). **Agent-Stand nach diesem Lauf:** backend (grants 01KV3TFX81) Notes waren noch stale „blocked" → mit Rebase-Unblock-Anweisung aktualisiert (Branch test/issue-grants-coverage @040529e6 ist VOR #686 → `git rebase origin/main` PFLICHT); qa (proxy 01KV3TG2TH) hat Unblock+Rebase-Notes schon; idle scribe neuer Task 01KV40CX7Z = README packages/vue-components (disjunkt von grants/proxy/nest/ape-agent, Branch ab CURRENT main). Bisher noch KEINE Agent-PRs gepusht (Branches predaten #686, brauchen Rebase).
  - **[2026-06-14 Engine-Lauf] 2 Agent-PRs gereviewt+GEMERGED, 1 rot eskaliert, 3 neue Tasks, 1 eigener M2-PR:** **#693** (scribe vue-components README) STRENG reviewt — alle 10 Exports gegen src/index.ts, useIdpAuth-Returns + /api/me + /api/session/logout, useKeyLogin(idpBaseUrl='')-Signatur + /api/auth/challenge + /api/session/login, alle 4 cli-grants-Funktionen (`type==='openape_cli'`-Filter, `.permission`-map) zur Quelle getraced → exakt korrekt → GEMERGED (squash). **#695** (qa proxy grants-client edge-Tests) STRENG reviewt — alle 5 Tests gegen `findExistingGrant`-Impl (ok-Guard→null, `grant_type==='once'`-Skip, host/audience-Match, `permissions.every`-Check, Bearer-Header nach setAgentToken) verifiziert, CI grün → GEMERGED (squash). **#694** (backend grants standing-grant-Tests): CI `ci` ROT (deterministisch, 2× nach close/reopen-Retrigger). **Tief untersucht:** lokal die EXAKTEN CI-Commands reproduziert (`turbo run lint typecheck test --affected` = 53/53 EXIT 0; `turbo run build --affected --concurrency=1` = 19/19 EXIT 0) auf HEAD 2abf63b5 — alles grün, Diff ist test-only. Red reproduziert NICHT → Runner-seitig (CI-Job hat bekannten 4-core-SIGHUP/exit-129-Thrash + `cancel-in-progress`-concurrency markiert superseded runs als failed). Forgejo-Version exponiert KEINE Run-Logs via API (404), daher keine Server-Bestätigung. NICHT gemergt (rotes CI = Policy); evidenzbasierter Kommentar gepostet + **an Patrick eskaliert: #694 braucht clean CI-Re-Run, Change selbst ist sound.** **#697** NEU (scribe, protocol-conformance README) — beim Run-Ende CI pending, nächster Lauf reviewen. **Eigener PR #696 GEMERGED** (chatSocketUrl, s.o.). **Agent-Tasks (alle 3 Agents idle nach 693/695-Merge):** scribe→01KV41NZN3 (protocol-conformance README, schon als #697 geliefert!), backend→01KV41P01J (server under-tested-Modul edge-Tests), qa→01KV41P0A6 (core untested-Modul edge-Tests) — alle disjunkt voneinander + von ape-agent/nest. Stale scribe-Self-Note 01KV40T1TK (an patrick zurück) als done geschlossen-Versuch (CLI-Output leer, ggf. nochmal prüfen).
- [ ] M3 Tool-Isolation — offen
- [ ] M4 Cutover + pm2 weg — offen

## Surprises & Discoveries

- **[2026-06-14] M0-GOTCHA: `sudo` stripped Env-Vars** → Secrets können NICHT über
  die Parent-Prozess-Env durch `sudo -u <agent>` an Tools gereicht werden (Spike:
  beide Kinder sahen `"NONE"`-Fallback statt Token). **Konsequenz fürs Design:** Der
  Nest hält KEINE per-Agent-Env-Maps. Stattdessen **self-materialize at tool time** —
  der sudo'd Agent-Shell unsealt seine eigenen Secrets (er besitzt den x25519-Key),
  z.B. `sudo -u <a> sh -c 'eval "$(apes secrets shell-export)"; <cmd>'`. Bewiesen:
  self-materialize liefert pro Agent den korrekten Token (Hash matcht Holder-Map).
  **Sicherheits-Plus:** Nest-root hält nie Klartext; Secrets bleiben pro Agent scoped.
  Vereinfacht M2 (kein Env-Map-Management im Host) + M3 (Wrapper = self-materialize).
- [2026-06-14] M0: Holder-Isolation in 1 Prozess hält — backend/qa in distinkte Maps,
  `process.env` sauber, distinkte Tokens; cross-read auf fremdes Home = Permission
  denied. Evidenz: `/tmp/spike-isolation.mjs`-Lauf.
- [2026-06-14] `MaterializeOptions.env` existiert bereits (für Tests) → per-Agent-
  Env-Map ist kein neuer Mechanismus, nur konsequent genutzt. Evidenz:
  `agent-secrets-runtime.ts:44`.
- [2026-06-14] `runAsAgent`/`sudoAs` (#657) liefert das Tool-Isolations-Muster
  schon. Evidenz: `troop-ws.ts`.
- [2026-06-14] Nest reconcilet bewusst nur bei Registry-**Änderung** (kein blind-
  Poll, der gesunde Bridges reloadet) — der SessionHost muss dieselbe Disziplin
  haben. Evidenz: `index.ts:69-80`.

- **[2026-06-14] tsup-Shebang-Banner bricht Library-Imports:** ein bin-Package
  zur Library zu machen heißt NICHT nur `entry`+`exports` ergänzen — der globale
  `banner: { js: '#!/usr/bin/env node' }` landet sonst auch in der Library-`.mjs`,
  und ein `#!` mitten im Bundle (vite injiziert davor noch `import.meta.env=…`)
  lässt Downstream-Bundler (vitest/rolldown: „Invalid Character `!`") hart
  failen. Fix: tsup `defineConfig([...])` mit ZWEI Configs — bins mit Shebang,
  Library ohne (+ `clean:false` auf der zweiten, sonst wischt sie die bin-Outputs).
  Evidenz: `apps/openape-ape-agent/tsup.config.ts`, Fehler erst im nest-Test
  reproduziert, nach Split grün.

## Decision Log

| Datum | Entscheidung | Begründung | Verworfen |
|-------|-------------|------------|-----------|
| 2026-06-14 | 1 Nest-Prozess + in-process Sessions | runLoop schon in-process; collapse 26→1; Live-Antworten bleiben schnell | Ephemeral-Worker (Kaltstart/Live-Chat träger); Status-quo+Watchdog (Komplexität bleibt) |
| 2026-06-14 | OS-User bleiben, Isolation zur Tool-Zeit | Sicherheits-Property (Secret-Scoping) erhalten ohne Per-Prozess | Isolation ganz fallen lassen (unsicher) |
| 2026-06-14 | N WS in 1 Prozess statt Multiplexing | Sockets billig; kein troop-Protokoll-Eingriff nötig | troop-seitiges Multiplexing (Scope-Ausweitung) |
| 2026-06-14 | Feature-Flag-Cutover (M2→M4) | pm2 als Netz bis in-process bewiesen | Big-Bang-Ersetzung (riskant) |

## Session-Checkliste

1. Plan + Progress lesen. 2. `git log` seit letztem Commit. 3. Nest-Image bauen +
recreaten (Memory-Rezept), Baseline 13 Bridges. 4. Nächsten offenen Milestone.
5. Implementieren, pro Milestone committen (nest-fix → PR wie #658/#659, CI grün,
mergen). 6. E2E-Akzeptanz via Container, nicht nur Unit. 7. Progress + Discoveries
updaten.

## Outcomes & Retrospective

> Nach Abschluss füllen.
