# Migration: Mac → Docker (M2 tracker)

Tracks the safe/deferred split for the Mac-to-Docker nest migration.
Search for `REMOVE-AFTER: cutover-verified` in the codebase to find all
tagged deferral points.

---

## DONE (M2 — safe, behavior-preserving)

### 1. Hatch bundles set `OPENAPE_BRIDGE_TARGET=troop`

**Files changed:**
- `apps/openape-troop/server/api/nest/hatch.post.ts` — `buildNestComposeYaml`
- `apps/openape-troop/server/api/pod/hatch.post.ts` — `buildComposeYaml`

**What:** Both hatch endpoints now emit `OPENAPE_BRIDGE_TARGET: troop` in the
`openape-nest` service `environment:` block of the generated docker-compose YAML.

**Why:** The bridge reads `process.env.OPENAPE_BRIDGE_TARGET` at startup. Its
default is `'chat'` (deferred, see below). New Docker nests that don't set it
would silently connect to `chat.openape.ai` instead of the troop WS — they'd
appear online but be unreachable via troop. The compose environment block is
the correct injection point because it takes precedence over `process.env` and
is set before the bridge process starts.

**Test:** `apps/openape-troop/tests/hatch-bundle.test.ts` asserts both bundles
contain `OPENAPE_BRIDGE_TARGET: troop` and do NOT reference `chat.openape.ai`.

### 2. Exoscale adapter: explicit 501 Not Implemented

**File changed:** `apps/openape-troop/server/utils/cloud/exoscale.ts`

**What:** `callExoscale` now throws `createError({ statusCode: 501,
statusMessage: 'Exoscale provisioning not implemented' })` instead of a
generic `Error('...scaffold — wire...')`.

**Why:** A generic Error leaking through the API is worse than an explicit 501.
The old message looked like an internal bug; the 501 is an intentional
"not yet available" signal to any client that calls `/api/pod/hatch`.

**Test:** `apps/openape-troop/tests/cloud-exoscale.test.ts` — added test that
with credentials set, `createInstance` rejects with `statusCode: 501`.

### 3. Cron comment cleanup (launchd → container cron runner)

**Files changed:**
- `apps/openape-troop/server/utils/task-validation.ts` — comment updated
- `apps/openape-troop/server/api/agents/me/tasks.get.ts` — comment updated

**What:** Comments that referenced "launchd reconciler" and "materialise launchd
plists" updated to reflect that the cron is now driven by the bridge daemon's
in-process `CronRunner` (no launchd, no per-task plist).

**Validation logic unchanged** — the cron subset (5-field, `*`, `N`, `*/N`)
is the same; only the explanatory comment changed.

---

## DEFERRED (cutover-dependent — do NOT remove yet)

All deferred points are tagged `// REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)`.

### A. Bridge `OPENAPE_BRIDGE_TARGET` default + `ChatApi` dual backend

**Tagged in:** `apps/openape-ape-agent/src/bridge.ts`
- `readConfig()`: `process.env.OPENAPE_BRIDGE_TARGET ?? 'chat'` default
- `Bridge` constructor: `ChatApi` vs `TroopChatApi` selection

**Why deferred:** Changing the default from `'chat'` to `'troop'` would break
any live Mac-based nest that does NOT set `OPENAPE_BRIDGE_TARGET`. The bridge
reads this at startup; a wrong default silently routes messages to the wrong
backend with no error until the first chat message fails.

**Gate to remove:** Confirm via troop prod DB that NO active agent is connecting
via the chat backend. Query: check nests whose bridge process does NOT pass
`OPENAPE_BRIDGE_TARGET=troop` — identifiable by agents last seen via
`chat.openape.ai` websocket sessions. Then:

1. Flip default to `'troop'`
2. Remove `ChatApi` import and `chat-api.ts`
3. Remove the `TroopChatApi | ChatApi` union type; use `TroopChatApi` directly

### B. Legacy keypair auth path in nest-ws.ts

**Tagged in:** `apps/openape-troop/server/routes/api/nest-ws.ts`
- `act: 'agent'` branch in `authenticateUpgrade`

**Why deferred:** The legacy keypair path (`act=agent` IdP-signed JWT, owner
resolved from `parseAgentEmail`) is still needed for nests that haven't
migrated to device-token auth (M4δ). Removing it disconnects those nests.

**Gate to remove:** Confirm via troop prod DB that NO nest connects with
`device_secret_hash IS NULL` (null = legacy keypair auth, never bound via
`POST /api/nests/bind`). Query example:
```sql
SELECT host_id, owner_email, last_seen_at
FROM nests
WHERE device_secret_hash IS NULL AND status = 'active';
```
If empty: remove the `act: 'agent'` branch and `parseAgentEmail` import.

### C. Mac-path references in ape-agent (~/Library, launchd)

**Tagged in:**
- `apps/openape-ape-agent/src/bridge.ts` — `loadBridgeEnvFile` reads
  `~/Library/Application Support/openape/bridge/.env`
- `apps/openape-ape-agent/src/identity.ts` — error message mentioning launchd plist
- `apps/openape-ape-agent/src/cron-runner.ts` — `TASK_CACHE_DIR` at `~/.openape/agent/tasks/`

**Why deferred:** Docker nests don't use `~/Library/Application Support` (Linux
container). The `loadBridgeEnvFile` path silently no-ops on Linux (file not
found → early return), so it doesn't break Docker. But it's dead code there.
`TASK_CACHE_DIR` works in Docker (it's under `~` which is `/root` in the
container), but the canonical post-cutover location should be
`/var/lib/openape/agent/tasks/`.

**Gate to remove:** After confirming no live Mac nests remain:
1. Remove `loadBridgeEnvFile` (Docker nests get env from compose `environment:`)
2. Update `TASK_CACHE_DIR` to `/var/lib/openape/agent/tasks/` (or make it
   configurable via `OPENAPE_AGENT_DATA_DIR`)
3. Remove launchd references from `identity.ts` error message

---

## How to verify cutover is complete

```sql
-- troop prod DB (openape-troop.db on chatty)
-- 1. Legacy keypair nests still active:
SELECT host_id, owner_email, last_seen_at
FROM nests
WHERE device_secret_hash IS NULL AND status = 'active';

-- 2. Agents last synced before the hatch fix was deployed
--    (these might still be running the old bridge with no BRIDGE_TARGET):
SELECT email, owner_email, last_seen_at
FROM agents
WHERE last_seen_at < <deploy_timestamp>;
```

Access: requires SSH to chatty + `sqlite3 ~/projects/openape-troop/shared/data/openape-troop.db`
(prod DB access was not available during M2 — hence the deferral).
