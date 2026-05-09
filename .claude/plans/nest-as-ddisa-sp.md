# Plan: Nest als DDISA-Service-Provider

> Dieser Plan ist **self-contained** — von oben nach unten lesbar ohne Vorwissen.

## Purpose / Big Picture

Aktueller Stand: Der Nest-Daemon hört auf `127.0.0.1:9091` ohne Auth. Jeder lokale Prozess der als Patrick läuft kann `curl POST /agents` machen und Agents spawnen. Das funktioniert, aber:

- Kein Audit-Trail über Nest-Operationen am IdP
- Compromised lokaler Prozess kann unbegrenzt Agents anlegen (jeder Folge-Spawn wird YOLO-auto-approved)
- Cross-Device-Calls (z.B. iPhone → Mac-Nest) gehen heute nicht, weil keine kryptographische Identitätsprüfung am Nest stattfindet
- Agent-zu-Agent-Spawning hat keine Delegationsstruktur

Nach diesem Plan: jeder Nest-API-Call läuft durch das DDISA-Grant-System genau wie `apes run` heute. Patrick nutzt `apes nest spawn igor18` (statt `curl`), das erzeugt einen Grant, der von der existierenden YOLO-Policy auto-approved wird, das Grant-Token landet als Bearer am Nest, der Nest verifiziert kryptographisch.

- **Ziel:** `apes nest spawn igor18` funktioniert zero-prompt für Patrick, jeder Nest-API-Call hat einen Grant-Eintrag in der IdP-DB, ein Compromised lokaler Prozess kann nichts mehr ohne IdP-Round-Trip anstoßen.
- **Kontext:** Wurde explizit als nächster Schritt nach der erfolgreichen Inbetriebnahme von Nest+Bridge+Troop am 2026-05-09 identifiziert. Ist gleichzeitig die strukturelle Vorbereitung für die Delegation-Pipeline (Stage 2 aus dem ursprünglichen Nest-Plan).
- **Scope:**
  - **drin:** Bearer-Auth-Middleware am Nest, JWT-Verify gegen IdP-JWKS, command-Match per Route, neue CLI-Commands `apes nest spawn|destroy|list`, YOLO-Default-Patterns erweitert, JWKS-Cache.
  - **nicht drin:** RFC 8693 token-exchange / actor_token Refactor (= Stage 2.5, separater Plan), Cross-Device-Tunnel/Relay (= Stage 3), Agent-zu-Agent Spawning per Delegation (folgt natürlich daraus, wird aber separat getestet).

## Repo-Orientierung

- **Projekt:** OpenApe Monorepo
- **Pfad:** `/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo`
- **Tech-Stack:** Node.js 22+, Turborepo, pnpm Workspace, Changesets, h3 (in Apps), `@openape/core` (`verifyJWT`, `createRemoteJWKS`), `jose` (JWT lib).
- **Dev-Setup:**
  - Build: `pnpm turbo run build --filter=@openape/nest --filter=@openape/apes`
  - Lint+Typecheck: `pnpm turbo run lint typecheck --filter=@openape/nest --filter=@openape/apes`
  - Lokal-Reinstall: `cp apps/openape-nest/dist/index.mjs /opt/homebrew/lib/node_modules/@openape/nest/dist/index.mjs`
  - Daemon-Restart: `launchctl bootout gui/501/ai.openape.nest && launchctl bootstrap gui/501 ~/Library/LaunchAgents/ai.openape.nest.plist`
  - Nest-Log: `tail -f ~/Library/Logs/openape-nest.log`

### Relevante Dateien

| Pfad | Funktion / Zweck |
|---|---|
| `apps/openape-nest/src/index.ts` | HTTP-Server, Routing, SIGTERM/SIGINT — wird um Auth-Middleware erweitert |
| `apps/openape-nest/src/api/agents.ts` | `handleAgentSpawn`, `handleAgentDestroy`, `handleAgentsList`, `handleNestStatus` — bekommen `caller`/`grant` Context |
| `apps/openape-nest/src/lib/registry.ts` | unverändert |
| `apps/openape-nest/src/lib/auth.ts` | **NEU** — JWT-Verify, JWKS-Cache, command-Match |
| `packages/apes/src/commands/nest/index.ts` | mountet zusätzlich `spawn`, `destroy`, `list` Subcommands |
| `packages/apes/src/commands/nest/spawn.ts` | **NEU** — Grant-Flow + HTTP-Call analog zu `apes run` |
| `packages/apes/src/commands/nest/destroy.ts` | **NEU** |
| `packages/apes/src/commands/nest/list.ts` | **NEU** |
| `packages/apes/src/commands/nest/authorize.ts` | erweitert um Default-Patterns `nest spawn *`, `nest destroy *` |
| `packages/apes/src/lib/grants.ts` *oder* `packages/apes/src/lib/run.ts` | bestehende Helfer für Grant-Erzeugung — Wiederverwenden, nicht duplizieren |
| `apps/openape-free-idp/server/utils/yolo-evaluator.ts` | unverändert (bestehender Glob-Matcher reicht) |
| `apps/openape-free-idp/server/api/grants/index.post.ts` | prüfen ob audience-Whitelist erweitert werden muss |

### Conventions die wir behalten

- **Audience pro Service**: existing `escapes`, `ape-shell`, `ape-proxy`, `claude-code`, `shapes`. Wir nehmen `nest`. Pro-Mac-Trennung (`nest-<hostname>`) wäre sauberer aber komplizierter — verworfen für v1, siehe Decision Log.
- **command field als Array**: existing convention im Grant-Body. Wir nutzen `["nest","spawn","igor18"]`, joined per space ergibt YOLO-Target `nest spawn igor18`.
- **target_host als macOS-Hostname**: existing convention für lokale Hosts. Bei Cross-Device-Calls später muss das `target_host` der ZielHostname sein, nicht der CallerHostname — gleiche Semantik wie escapes heute.
- **cmd_hash für Replay-Protection**: existing — Nest verifiziert dass cmd_hash zum tatsächlichen Request-Body passt.

## Milestones

### Milestone 1: Read-only API (`/status`, `GET /agents`) durch DDISA Bearer-Auth schützen

**Ziel:** Der Nest-API verlangt einen Bearer-Token an `/status` und `GET /agents`, verifiziert ihn gegen die IdP-JWKS, und matched das Grant-`command` mit der Route. `apes nest status` und `apes nest list` (CLI-Wrapper) machen den Round-Trip durch das Grant-System. Auf `POST /agents`/`DELETE /agents/<x>` greift die Auth noch nicht — wir wollen den schreibenden Pfad isoliert in M2 testen.

**Schritte:**

1. **Neue Datei `apps/openape-nest/src/lib/auth.ts`**:
   - Exportiert `verifyNestGrant(token: string, expectedCommand: string[]): Promise<{ caller: string, grantId: string }>`.
   - Liest `idpUrl` aus env (`OPENAPE_IDP_URL`, default `https://id.openape.ai`).
   - JWKS-Cache: einmal `createRemoteJWKS(new URL('/.well-known/jwks.json', idpUrl))` und wiederverwenden über die Lebensdauer des Daemons.
   - `verifyJWT` aus `@openape/core` mit `{ issuer: idpUrl, audience: 'nest' }`.
   - Verifizieren: `claims.command.join(' ') === expectedCommand.join(' ')` (exakt-match — kein Glob, das hat YOLO schon erledigt).
   - Verifizieren: `claims.target_host === os.hostname()` (Replay-Schutz für Cross-Mac-Calls).
   - Verifizieren: `claims.cmd_hash === sha256(claims.command.join('\n') + '\n' + (claims.run_as ?? ''))` — gleiche Hash-Convention wie escapes (nachsehen: `packages/apes/src/lib/grants.ts` oder ähnlich).
   - Verifizieren: `claims.exp > now`, `claims.aud === 'nest'`.
   - Throw spezifische Errors mit HTTP-Status-Hint (`401` für Auth-Fail, `403` für Command-Mismatch).

2. **Erweiterung `apps/openape-nest/src/index.ts`**:
   - Neue Helferfunktion `requireNestGrant(req, expectedCommand, sendError) → Promise<{caller, grantId} | null>`. Liest `Authorization: Bearer …`, ruft `verifyNestGrant`, sendet bei Fehler 401/403 + Problem-JSON, returned `null`.
   - In den GET-Handlers wird der Helper aufgerufen mit dem entsprechenden command-Array. Bei `null` ist die Response schon gesendet, einfach return.
   - `RouteCtx` erweitert um `caller: string` und `grantId: string`.

3. **`packages/apes/src/commands/nest/list.ts`** (NEU):
   - Citty-Command. Tut: Grant-Request mit `command: ['nest', 'list']`, audience `nest`, target_host = lokaler hostname. Wartet (`apes run`-äquivalente Logik) auf Approval (YOLO sollte sofort approven). Holt Grant-Token. `fetch GET http://127.0.0.1:9091/agents` mit `Authorization: Bearer <token>`. Output table.
   - Gemeinsame Helfer: prüfen ob `packages/apes/src/lib/run.ts` (oder wo immer `apes run` lebt) eine wiederverwendbare `requestAndAwaitGrant({command, audience, targetHost, runAs?})` Funktion hat. Wenn ja: nutzen. Wenn nicht: extrahieren.

4. **`packages/apes/src/commands/nest/index.ts`**: `list` mounten.

5. **YOLO-Default erweitern**: `packages/apes/src/commands/nest/authorize.ts` `DEFAULT_ALLOW_PATTERNS` erweitert um `nest list`, `nest status`. Damit der erste Test ohne extra-Patrick-Approval läuft.

6. **JWKS-Reachability prüfen**: `apps/openape-nest/src/index.ts` beim Start einmal `getJwks()` aufrufen und beim Fehler ins Log loggen — verhindert verzögerten ersten Auth-Fail.

**Akzeptanzkriterien (beobachtbares Verhalten):**

- [ ] `pnpm turbo run lint typecheck --filter=@openape/nest --filter=@openape/apes` → 0 Fehler
- [ ] `pnpm turbo run build --filter=@openape/nest --filter=@openape/apes` → erfolgreich
- [ ] Nach Reinstall + Daemon-Restart: `curl http://127.0.0.1:9091/agents` ohne Bearer → `401 {"type":"about:blank","status":401,"title":"..."}`
- [ ] `apes nest list` → Tabelle der Agents (gleicher Output wie `cat ~/.openape/nest/agents.json | jq` heute), kein Approval-Prompt (YOLO-auto-approved)
- [ ] Nest-Log zeigt einen Eintrag pro Aufruf: `nest: GET /agents authorized (caller=patrick@hofmann.eco, grant=<id>)`
- [ ] In der IdP-Grants-Übersicht (`https://id.openape.ai/grants`) erscheint ein Eintrag pro Aufruf mit `auto_approval_kind: yolo`

**Rollback:** PR revert. Daemon mit alter dist neu starten — Auth wird wieder skipped, alles wie vorher.

---

### Milestone 2: Schreibende API (`POST /agents`, `DELETE /agents/<name>`) durch DDISA Bearer-Auth schützen

**Ziel:** `apes nest spawn igor18` und `apes nest destroy igor18` ersetzen das `curl`-Muster. Nach dem Milestone hat **kein** Code-Pfad mehr Schreibzugriff auf die Nest-API ohne Grant — die alten `curl POST /agents` Aufrufe würden 401 zurückgeben.

**Schritte:**

1. **`apps/openape-nest/src/index.ts`**: `requireNestGrant` auch in `POST /agents` und `DELETE /agents/<name>` Handlern. Command-Arrays:
   - `POST /agents` (body: `{name, bridge?, bridgeKey?, …}`) → `command: ['nest', 'spawn', name]` (die optional bridge-Args fließen NICHT ins command — sonst müsste YOLO sie matchen, ergäbe Pattern-Bloat)
   - `DELETE /agents/igor18` → `command: ['nest', 'destroy', 'igor18']`

2. **`packages/apes/src/commands/nest/spawn.ts`** (NEU):
   - Args: `name` (positional), `--bridge/--no-bridge`, `--bridge-key`, `--bridge-base-url`, `--bridge-model`
   - Tut: `requestAndAwaitGrant({command: ['nest','spawn',name], audience:'nest', targetHost: hostname()})`. Mit Grant-Token: `fetch POST http://127.0.0.1:9091/agents` (Body inkludiert die bridge-Args, das command nicht).
   - Output: gleiches Format wie `curl` heute (`{name, email, uid, home}`).

3. **`packages/apes/src/commands/nest/destroy.ts`** (NEU):
   - Args: `name` (positional), `--force` (durchgereicht).
   - Tut: `requestAndAwaitGrant({command: ['nest','destroy',name], audience:'nest', targetHost: hostname()})`. Mit Grant-Token: `fetch DELETE http://127.0.0.1:9091/agents/<name>`.

4. **`packages/apes/src/commands/nest/index.ts`**: `spawn` und `destroy` mounten.

5. **YOLO-Default erweitern**: `DEFAULT_ALLOW_PATTERNS` in `nest/authorize.ts` erweitert um `nest spawn *`, `nest destroy *`. Bestehende Patterns (`apes agents spawn *`, `bash *apes-spawn-*setup.sh`, `openape-chat-bridge`) bleiben — der innere Spawn-Flow läuft weiter über die.

6. **Re-authorize ausführen**: Manueller Schritt nach Deploy: `apes nest authorize` neu laufen lassen, damit die neuen Default-Patterns in der laufenden YOLO-Policy landen.

**Akzeptanzkriterien (beobachtbares Verhalten):**

- [ ] `curl -X POST http://127.0.0.1:9091/agents -d '{"name":"igor99"}'` (ohne Bearer) → `401`
- [ ] `apes nest spawn igor99` → kein Approval-Prompt (YOLO matched), Output enthält `uid` und `home`. Dauert <2 Min (Grant-Flow + Spawn).
- [ ] Bridge für igor99 läuft: `ps aux | grep "openape-chat-bridge" | grep igor99` zeigt eine Zeile als User `igor99`
- [ ] igor99 sync auf troop: `cat /Users/igor99/Library/Logs/openape-troop-sync.log | tail` zeigt `✓ first sync — agent registered`
- [ ] `apes nest destroy igor99` → kein Prompt, danach `dscl . -read /Users/igor99` → "DS Error" (User weg)
- [ ] In der IdP-Grants-Übersicht erscheinen die zwei Grants (spawn + destroy) je mit `auto_approval_kind: yolo`
- [ ] Audit-Test: in der Konsole `apes grants list` zeigt die Nest-Grants in chronologischer Reihenfolge

**Rollback:** PR revert. Lokal `agents.json` leeren falls igor99 hängengeblieben ist und `apes agents destroy igor99 --force` direkt aufrufen.

---

### Milestone 3: Negative Tests + Doku

**Ziel:** Wir wissen mit Evidenz, dass die Auth-Schicht nicht nur den happy path macht, sondern auch böse Pfade ablehnt. Plus: README und `apes nest --help` erklären den neuen Flow.

**Schritte:**

1. **Negative Tests am laufenden Setup**:
   - Manipulierter Token (signature-broken): `apes nest spawn` mit hand-edited JWT → 401 erwartet
   - Falsches command im Grant: Token mit `command: ['nest','spawn','foo']` aber Request für `bar` → 403 erwartet
   - Anderer aud: `aud: 'escapes'` Token an Nest → 401 erwartet
   - Expired token: warten bis 5 Min nach Ausstellung, dann nochmal versuchen → 401 erwartet
   - target_host mismatch: Token mit `target_host: 'OtherMac'` an MinivonPatrick.fritz.box → 403 erwartet
   - Each test als Bash-Block in `apps/openape-nest/tests/auth-negative.sh` (manueller Test, nicht CI — die Tokens müssten sonst gemockt werden was den e2e-Charakter verliert).

2. **Update `apps/openape-nest/README.md`** (anlegen falls nicht vorhanden): Beschreibt den DDISA-geschützten Flow, mit Beispiel-curl ist DEPRECATED, neuer apes-CLI-Pfad als kanonisch.

3. **Update `packages/apes/src/commands/nest/index.ts` description**: erwähnt explizit dass `spawn`/`destroy`/`list` durch das Grant-System gehen.

4. **CHANGELOG / changeset**: dokumentiert dass `curl POST` jetzt 401 gibt — Breaking Change für jeden der das automatisiert hatte.

**Akzeptanzkriterien (beobachtbares Verhalten):**

- [ ] `bash apps/openape-nest/tests/auth-negative.sh` läuft alle 5 negative tests durch und reportet "5/5 passed"
- [ ] `apes nest --help` zeigt `spawn`, `destroy`, `list` mit Beschreibungen die DDISA erwähnen
- [ ] README erwähnt nichts mehr direkt-curl als Standard-Pfad

**Rollback:** Doku revert (zero blast radius).

---

## Progress

- [ ] `[2026-05-09 16:30]` Plan geschrieben, Patrick freigegeben — los
- [ ] `[ ]` Milestone 1: Read-only API geschützt
- [ ] `[ ]` Milestone 2: Schreibende API geschützt
- [ ] `[ ]` Milestone 3: Negative Tests + Doku

## Surprises & Discoveries

(Während Implementation füllen)

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-05-09 | Audience `nest` (nicht `nest-<hostname>`) | Pro-Mac-Trennung wäre sauberer aber bringt Cross-Device-Komplexität (Mac-A-Patrick will Mac-B-Nest steuern, dann müssten Tokens für jeden Ziel-Mac neu ausgestellt werden). `target_host`-Claim in DDISA-Grants löst Replay-Schutz cross-Mac. | Ein audience pro Hostname; oder gar keine audience. Beides verwirft Replay-Resistenz oder ist dem v1 nicht angemessen. |
| 2026-05-09 | command-Array als YOLO-Target, NICHT inkl. bridge-Optionen | Sonst müsste Patrick ein YOLO-Pattern pro Bridge-Konfiguration schreiben. Bridge-Optionen sind Implementierungsdetails des Spawn, nicht Teil der Identität "wer darf was". | bridge-Optionen mit ins command-Array; oder pro Option ein Selektor. Beides ergibt Pattern-Explosion. |
| 2026-05-09 | Bearer-Token-Auth statt mTLS | DDISA ist schon stateless-JWT-basiert, mTLS würde eine zweite PKI-Hierarchie einführen. JWT mit Audience+Issuer+Signature reicht für v1. | mTLS zwischen apes-cli und Nest. |

## Session-Checkliste

1. Plan lesen, Progress-Section prüfen
2. `git log --oneline -10` lesen — was ist seit letzter Session passiert
3. Daemon-Health: `tail -5 ~/Library/Logs/openape-nest.log`, `apes nest list` (sobald M1 steht)
4. Nächsten offenen Milestone identifizieren
5. Implementieren, nach jedem Milestone committen
6. E2E-Verifikation der Akzeptanzkriterien (echter HTTP-Call gegen den laufenden Daemon)
7. Progress-Section + Discoveries aktualisieren

## Outcomes & Retrospective

(Nach Abschluss aller Milestones füllen.)
