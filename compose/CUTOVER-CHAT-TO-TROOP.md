# Cutover: bridges from chat.openape.ai → troop

Final step in plan
[01KSWSHPA4C320VV0BKK98EZ0V](https://plans.openape.ai/p/01KSWSHPA4C320VV0BKK98EZ0V).
After this, troop is fully self-contained: nest + agents connect to
troop for chat traffic, chat.openape.ai is no longer in the path.

## Prerequisites

1. PR #507 merged → troop deployed to https://troop.openape.ai (or
   pointed at a local dev troop for testing).
2. The 4 agents have synced to troop at least once
   (`apes agents sync` from inside each bridge once per session — the
   nest's `TroopSync` does this on its 5-min loop). Verify:
   ```bash
   docker exec openape-nest sh -c 'sqlite3 /var/lib/openape/nest/.openape/nest/agents.json ".tables"'
   # ↑ that's the local registry; the canonical troop agents table is
   # on the troop server.
   ```
   Or hit `GET https://troop.openape.ai/api/agents` from your browser
   (logged in) and confirm coder/iurio/stephan/bluesky are listed.

## Cutover

Set two env vars on the compose service and recreate. The nest's
entrypoint + supervisor pick up the env, and pm2's ecosystem `env:`
block (already shipped) forwards them into each bridge.

```bash
cd ~/Companies/private/repos/openape/openape-monorepo

# Add to compose/.env (or wherever your compose .env lives):
cat >> compose/.env <<'EOF'

# Phase J of the chat-to-troop migration: bridges talk to troop.
OPENAPE_BRIDGE_TARGET=troop
APE_CHAT_ENDPOINT=https://troop.openape.ai
EOF

docker compose -f compose/docker-compose.yml down
docker compose -f compose/docker-compose.yml up -d
```

Wait ~15s for the entrypoint to re-create the agent users, the
supervisor to reconcile, and the bridges to connect to troop.

## Verify

```bash
docker exec openape-nest sh -c 'sudo -n -H -u coder pm2 logs openape-bridge-coder --lines 5 --nostream --err' 2>&1 \
  | grep "connected as"
# Should now show "connected as coder-…@id.openape.ai → https://troop.openape.ai"
# (instead of → https://chat.openape.ai)
```

From troop UI: open `troop.openape.ai/agents/coder` → chat tab shows
empty history (the troop-native `chat_messages` table starts fresh).
Send "Ping" → agent replies within ~1s (WS is live, no polling delay).

Repeat for iurio/stephan/bluesky.

## Rollback

If anything misbehaves, revert by removing the two env vars and
cycling the pod. Bridges go back to chat.openape.ai with their full
history intact (chat.openape.ai's database wasn't touched).

```bash
sed -i '' '/OPENAPE_BRIDGE_TARGET=/d;/APE_CHAT_ENDPOINT=/d' compose/.env
docker compose -f compose/docker-compose.yml down
docker compose -f compose/docker-compose.yml up -d
```

## What's deprecated after this lands

- `apps/openape-chat/` — historical archive. The old chat.openape.ai
  database keeps the pre-cutover conversation history (browseable
  if needed), but no new messages flow there.
- `apps/openape-ape-agent/src/chat-api.ts` (ChatApi class) — the
  chat.openape.ai client is still in the binary as the
  `OPENAPE_BRIDGE_TARGET=chat` fallback. Remove in a follow-up once
  the cutover sticks for a few weeks without rollback.
