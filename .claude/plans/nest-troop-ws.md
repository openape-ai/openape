# Plan: Nest ↔ Troop WebSocket Control-Plane

> Self-contained. Future-Patrick (or another agent) reads this top-to-bottom and produces a working result without any prior context.

## Purpose / Big Picture

- **Ziel:** Owner ändert in der troop UI eine Agent-Konfiguration (system prompt, tools, skills, SOUL) oder klickt „Spawn new agent" — der lokale Nest-Daemon auf dem Mac führt den Change in unter einer Sekunde aus statt nach max. 5 min sync poll. Spawn-Operationen lösen weiterhin den DDISA-Grant-Cycle aus (Push an Patrick's iPhone), aber die *Auslösung* kommt jetzt von troop.
- **Kontext:** Heute pollen Bridges alle 5 min `apes agents sync`. Edits in troop landen also mit bis zu 5 min Verzögerung beim Agent. Spawning erfordert physischen Zugriff auf den Mac (`apes nest spawn`). Beides ist friction für den 2026-Workflow „Patrick am iPhone, Mac im Schrank".
- **Scope:**
  - **Drin:** Persistenter WebSocket Nest → troop, Frame-Protokoll mit `config-update` und `spawn-intent`, in-memory Connection-Registry in troop, „Online"-Badge + „Spawn"-Wizard in troop UI, automatische `apes agents sync` Trigger beim config-update.
  - **Nicht drin:** Cross-Region/Cross-Tenant deployment, Mehrfach-Owner-Approval (DDISA delegation grants existieren schon, nicht Teil dieses Plans), Persistente Nest-Host Registry in troop DB (kann später kommen), Edge-Polling-Tuning („Polina") — 5min poll bleibt als Cold-Path-Fallback unverändert.

## Repo-Orientierung

- **Projekt:** `openape-monorepo` unter `~/Companies/private/repos/openape/openape-monorepo/`
- **Relevante Module:**
  - `apps/openape-nest/src/index.ts` — Nest daemon entry, schon long-running CLIENT-only
  - `apps/openape-nest/src/lib/pm2-supervisor.ts` — managed bridges
  - `apps/openape-nest/src/lib/troop-sync.ts` — existing 5min poll (bleibt als fallback)
  - `apps/openape-troop/server/routes/api/ws.ts` — existiert nicht; das ist neu
  - `apps/openape-chat/server/routes/api/ws.ts` — funktionierende WS-Vorlage (auth, ping, registerPeer, close-cleanup, focus-frame parsing)
  - `apps/openape-troop/server/api/agents/[name].patch.ts` — wo PATCH-Hook für config-update broadcast kommt
  - `apps/openape-troop/server/api/agents/[name]/skills/*.ts` — gleicher Hook für skill changes
  - `apps/openape-troop/app/pages/agents/[name].vue` — wo „online"-badge gerendert wird
  - `apps/openape-troop/app/pages/index.vue` — wo „Spawn new agent" CTA hin sollte
  - `packages/cli-auth/` — Token-refresh pattern den nest weiter benutzt
- **Tech-Stack:** Nuxt 4 (troop), nitro WebSocket via crossws, Node 22 daemon (nest), drizzle-orm. Auth via DDISA JWTs aus `~/.config/apes/auth.json` (nest) und SP-session-cookies (troop UI).
- **Dev-Setup:**
  - Troop dev: `pnpm --filter @openape/troop dev` (Port 3010)
  - Nest dev: `apps/openape-nest` hat kein dev-server — geht über `node .output/server/index.mjs` oder pm2 in production. Für Test: `node apps/openape-nest/dist/index.mjs --once`
  - Beide CI-grün via `pnpm turbo run build lint typecheck test --filter='./apps/openape-nest' --filter='./apps/openape-troop'`

## Frame-Protokoll

```ts
// nest → troop
type NestHello   = { type: 'hello', host_id: string, hostname: string, version: string }
type NestHeartbeat = { type: 'heartbeat' }
type NestSpawnResult = { type: 'spawn-result', intent_id: string, ok: boolean, agent_email?: string, error?: string }

// troop → nest
type TroopConfigUpdate = { type: 'config-update', agent_email: string }  // nest re-syncs the named agent
type TroopSpawnIntent  = { type: 'spawn-intent', intent_id: string, name: string, bridge: { key?: string, base_url?: string, model?: string }, soul?: string, skills?: Array<{name,description,body}> }
type TroopDestroyIntent = { type: 'destroy-intent', intent_id: string, name: string }   // Phase-2, nicht im MVP
type TroopReload = { type: 'reload-bridge', name: string }
```

Auth-Handshake (auf `wss://troop.openape.ai/api/nest-ws?token=…`):
- Token = DDISA-JWT mit `act: human` aus `~/.config/apes/auth.json` (owner-bearer), gleiches Pattern wie chat-bridge → chat
- Troop verifiziert via JWKS, extrahiert `sub = ownerEmail`
- Connection-Registry-Key: `(ownerEmail, host_id aus hello frame)` — host-id wird gegen pinned-id pro owner geprüft (analog zu `agents.host_id` pinning)

## Milestones

### Milestone 1: WS-Endpoint in troop + Echo-Test

**Ziel:** Nest kann WS aufbauen, troop antwortet mit hello-ack. Kein Business-Logic.

**Schritte:**
1. Create `apps/openape-troop/server/routes/api/nest-ws.ts` modeled after `apps/openape-chat/server/routes/api/ws.ts`:
   - JWKS-based JWT verify (use `@openape/core`'s `createRemoteJWKS` + `verifyJWT`, point at `id.openape.ai/.well-known/jwks.json`)
   - On open: re-verify token from `peer.request.url`, extract `sub` as ownerEmail. Reject with 1008 if `act !== 'human'`.
   - On hello frame: store `(ownerEmail, host_id, peer)` in a `Map<string, NestPeer>`, key by `${ownerEmail}::${host_id}`
   - On close: remove from registry
   - For now: log received frames to console, echo back `{ type: 'ack' }`
2. New helper: `apps/openape-troop/server/utils/nest-registry.ts` — `getNestPeer(email, host)`, `setNestPeer(...)`, `forEachOwnerPeer(email, fn)`
3. New `pnpm vitest` test: spawn a mock WS client, connect with a valid mock JWT, send hello, expect ack — basic protocol contract test.

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter='./apps/openape-troop'` enthält neuen `nest-ws.test.ts`, alle grün
- [ ] Lokal via `wscat -c 'ws://localhost:3010/api/nest-ws?token=…'` → empfange `hello`, sende `{"type":"hello","host_id":"test","hostname":"test","version":"0"}` → bekomme `{"type":"ack"}`

**Rollback:** Branch verwerfen, der Endpoint ist additiv.

### Milestone 2: Nest WS-client mit reconnect

**Ziel:** Nest baut beim Boot eine WS-Verbindung zu troop auf und hält sie offen. Sendet hello, sendet 30s heartbeats. Reconnect bei Disconnect mit exponentiellem Backoff (1s → 30s).

**Schritte:**
1. Create `apps/openape-nest/src/lib/troop-ws.ts`:
   - Reads token via `@openape/cli-auth`'s `ensureFreshIdpAuth()` (same pattern as bridge.ts)
   - Connects to `wss://troop.openape.ai/api/nest-ws?token=…`
   - On open: send `hello` (with `host_id` from IOPlatformUUID + hostname from `os.hostname()` + `version` from package.json)
   - 30s heartbeat ping; close after 90s of no pong (server-pong is browser/crossws default)
   - On close: `scheduleReconnect()` with expo backoff
   - Frame router: stub handlers for `config-update`, `spawn-intent` (just log for now, no-op execution)
2. Wire into `apps/openape-nest/src/index.ts` — start the WS-client alongside pm2-supervisor + troop-sync
3. New `apps/openape-nest/test/troop-ws.test.ts`: mock WS server, expect hello+heartbeat sequence

**Akzeptanzkriterien:**
- [ ] `pnpm turbo run test --filter='./apps/openape-nest'` grün, neuer test included
- [ ] In troop's nest-registry log appears: `nest connected: patrick@hofmann.eco / Mac-mini-von-Patrick.fritz.box`
- [ ] Kill troop process → nest log zeigt reconnect attempts mit expo backoff
- [ ] Restart troop → nest reconnected within 30s

**Rollback:** Disable WS-client in nest's index.ts; existing 5min-poll remains functional.

### Milestone 3: Config-update push-flow

**Ziel:** Owner saved system-prompt/tools/skills/soul change in troop UI → nest empfängt config-update über WS → nest triggert `apes agents sync` für den betroffenen Agent (YOLO-allowed, kein push-prompt) → bridge sieht neue agent.json beim nächsten Thread.

**Schritte:**
1. Troop PATCH-handlers (`apps/openape-troop/server/api/agents/[name].patch.ts` + skills index.put.ts + [skillName].delete.ts) hooken nach erfolgreicher DB-write: `forEachOwnerPeer(ownerEmail, peer => peer.send({type:'config-update', agent_email}))`
2. Nest WS-client (`troop-ws.ts`) frame-router: bei `config-update` → spawn `apes agents sync` als den Agent (`apes run --as <name> -- apes agents sync`). Reuse YOLO-policy `apes agents sync` so kein Patrick-prompt.
3. Sync schreibt agent.json + SOUL.md + skills/*/SKILL.md auf disk. Bridge liest pro Thread eh frisch → instant.

**Akzeptanzkriterien:**
- [ ] In troop UI: tools toggle bei igor30 → reload-Befehl in nest log innerhalb 1s
- [ ] On agent host: `cat /var/openape/homes/igor30/.openape/agent/agent.json` zeigt neue tools binnen ~5s (sync wall-clock)
- [ ] Neue chat-message an igor30 → bridge sieht die neuen tools (verifizierbar via tool_call log oder durch tool-spezifische Anfrage)

**Rollback:** Entferne die `forEachOwnerPeer`-Aufrufe aus den PATCH-handlers — config-changes propagieren wieder nur über den 5min-poll.

### Milestone 4: Spawn-intent flow + UI

**Ziel:** Owner klickt „+ Spawn agent" in troop UI → Wizard mit Name, Bridge-Key, Base-URL, Model, optional SOUL.md / Skills → POST `/api/agents/spawn-intent` → troop pushed intent über WS an nest → nest führt `apes agents spawn` aus → DDISA-grant push an Patrick → er approved → spawn fertig, troop UI flippt auf „✓ spawned".

**Schritte:**
1. New troop API endpoint `apps/openape-troop/server/api/agents/spawn-intent.post.ts`:
   - Owner-only (requireOwner)
   - Validates body (name regex, optional bridge config)
   - Picks first online nest for owner (multi-mac wizard kommt später)
   - Generates `intent_id` UUID, stores intent in `pendingIntents: Map<id, { resolve, reject, timeout }>` mit 5min timeout
   - Sends `spawn-intent` frame, returns `{ intent_id }`
2. Nest frame-router handler for `spawn-intent`:
   - Validates frame
   - Runs `apes agents spawn <name> --bridge-key … --bridge-base-url … --bridge-model …` via execFile
   - On success: send `spawn-result` `{ intent_id, ok: true, agent_email }`
   - On error: send `spawn-result` `{ intent_id, ok: false, error }`
3. Troop WS-server receives `spawn-result`, resolves the pending intent in `pendingIntents`
4. Endpoint returns the resolved result to the UI via a follow-up GET `/api/agents/spawn-intent/<id>` (or via polling, or via streaming — keep it simple with polling every 2s)
5. UI:
   - New component `apps/openape-troop/app/components/SpawnAgentDialog.vue` — form + submit + poll loop until result
   - „+ Spawn agent" CTA on `pages/index.vue`

**Akzeptanzkriterien:**
- [ ] In troop UI: click „Spawn agent" → form → submit → Patrick's iPhone bekommt push für DDISA-grant approval
- [ ] After approval: troop UI shows „✓ spawned: <name>" within 60s
- [ ] `apes agents list` on the mac includes the new agent

**Rollback:** Hide UI button, keep endpoint inactive — old `apes nest spawn` CLI path bleibt funktional.

### Milestone 5: Online-Badge + Status-API

**Ziel:** Troop UI zeigt pro Agent-Detail-Seite einen Online/Offline-Status („nest connected" / „nest offline — 5min poll fallback").

**Schritte:**
1. New endpoint `GET /api/nest/hosts` (owner-only): returns array of `{ host_id, hostname, last_seen_at, version }` from in-memory nest-registry
2. Agent-detail page (`pages/agents/[name].vue`) polls `/api/nest/hosts` every 30s, renders a small badge: green dot + „live (host)" or gray dot + „polling (offline)"

**Akzeptanzkriterien:**
- [ ] Open troop /agents/igor30 → green „live" badge visible
- [ ] Kill nest process on Mac → within 30s the badge flips to gray „polling"
- [ ] Restart nest → green again

**Rollback:** Hide badge — purely cosmetic.

### (Optional) Prototyping-Milestone

> Bei Unsicherheit über WS-auth-handshake mit JWKS in nitro/crossws context: 30min Spike.

**Ziel:** Verify dass `peer.request.url` in nitro's crossws handler den `?token=` Query-Param trägt und JWKS verify in dem Context funktioniert.
**Vorgehen:** Replicate apps/openape-chat/server/routes/api/ws.ts wireup, log peer.request.url, manual wscat connect.
**Ergebnis:** Token-Pfad bestätigt, Milestone 1 unblocked.

## Progress

- [ ] `[YYYY-MM-DD HH:MM]` Milestone 1: WS-Endpoint in troop + Echo-Test
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 2: Nest WS-client mit reconnect
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 3: Config-update push-flow
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 4: Spawn-intent flow + UI
- [ ] `[YYYY-MM-DD HH:MM]` Milestone 5: Online-Badge + Status-API

## Surprises & Discoveries

(Wird beim Implementieren laufend gefüllt — z.B. wenn crossws ein anderes peer-API hat als chat's WS handler annimmt.)

## Decision Log

| Datum | Entscheidung | Begründung | Alternativen verworfen |
|-------|-------------|------------|----------------------|
| 2026-05-12 | WS-Auth via DDISA-Bearer (owner-token aus `~/.config/apes/auth.json`), gleiches Pattern wie chat-bridge → chat | Bekanntes funktionierendes Pattern, kein neues auth-surface | Per-Mac SSH-key signature (komplexer, kein benefit); separate API-key (yet-another credential to manage) |
| 2026-05-12 | Connection-Registry in-memory only (Map), keine DB-tabelle | Nests reconnecten auto, kein Persistence-Need. Cross-region später wird eigene Story | DB-table `nest_hosts`: overkill für aktuellen scope |
| 2026-05-12 | Config-update Trigger ist nur `agent_email` (kein diff im frame) | Idempotent, einfacher, nest macht eh ein vollständiges sync. Auch besser für race-conditions bei mehreren rapid changes | Frame mit kompletten payload: doppelte source-of-truth, schwerer zu validieren |
| 2026-05-12 | Spawn-intent via polling der intent-id, nicht via streaming response | Einfacher UI-State, kein streaming-WS-fanout zum browser, ~60s wall-clock akzeptabel | SSE/streaming response: mehr code, marginaler UX-win |
| 2026-05-12 | 5min troop-sync bleibt aktiv parallel zur WS | Cold-path-fallback wenn WS down (Mac sleeping, network flaky). Kein duplicate-write-risk weil sync idempotent | WS-only: zu fragil für edge-conditions |

## Session-Checkliste

1. Plan lesen, Progress-Section prüfen
2. `git log --oneline -10` seit letztem commit
3. Dev-server: `pnpm --filter @openape/troop dev` (port 3010) + lokal nest gebaut (`pnpm --filter @openape/nest build`)
4. Baseline: hit `http://localhost:3010/` → troop login funktioniert; nest läuft ohne errors
5. Nächsten offenen Milestone identifizieren, dann implementieren
6. Nach jedem Milestone committen + Akzeptanzkriterien e2e prüfen (UI im Browser, WS via wscat, fs-zustand via `apes run --as`)
7. Progress + Discoveries aktualisieren

## Outcomes & Retrospective

(Erst nach Abschluss aller Milestones ausfüllen.)
