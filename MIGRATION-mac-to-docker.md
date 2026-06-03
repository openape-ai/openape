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

## DONE — Cutover-gated removals (2026-06-03, cutover confirmed)

Owner confirmed: the single live nest is device-bound (device_secret_hash
IS NOT NULL). No legacy keypair nests remain. All three deferred removal
groups below are now executed.

### A. Bridge dual backend removed — troop is the sole target

**Removed from:** `apps/openape-ape-agent/src/bridge.ts`
- `loadBridgeEnvFile()` (Mac-only `~/Library/Application Support/openape/bridge/.env` loader)
- `OPENAPE_BRIDGE_TARGET` env var and `'chat' | 'troop'` union in `BridgeConfig`
- `ChatApi` import + constructor branch in `Bridge`
- `APE_CHAT_ENDPOINT` env var (replaced by `OPENAPE_TROOP_URL`)

**Removed:** `apps/openape-ape-agent/src/chat-api.ts` (ChatApi + shared types)
**Removed:** `apps/openape-ape-agent/test/chat-api.test.ts` (tested removed behavior)

Shared types (`PostedMessage`, `HistoryMessage`, `ContactView`, `ChatBackend`)
moved into `troop-chat-api.ts`. `TroopChatApi` is now the only backend.
`DEFAULT_ENDPOINT` updated to `https://troop.openape.ai`.

### B. Legacy keypair auth path removed from nest-ws.ts

**Removed from:** `apps/openape-troop/server/routes/api/nest-ws.ts`
- `act: 'agent'` branch in `authenticateUpgrade()` (IdP-signed keypair JWT path)
- The three-flavour comment updated to two-flavour (device-token + human)

Device-token nests (troop HS256, `delegate='nest:<host_id>'`) and `act:human`
direct connections remain the only accepted auth paths.

### C. Mac-path references cleaned from ape-agent

**Updated:**
- `apps/openape-ape-agent/src/identity.ts` — removed launchd plist comment;
  error message + JSDoc updated to reflect container-env reality
- `apps/openape-ape-agent/src/cron-runner.ts` — REMOVE-AFTER comment replaced
  with current-state comment noting `~/.openape/agent/tasks/` resolves to
  `/root/.openape/…` in the container; OPENAPE_AGENT_DATA_DIR noted as future
  configurability path

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
