---
'@openape/ape-agent': minor
---

Remove legacy chat backend and Mac-path handling (M2 cutover confirmed).

The single live nest is device-bound; no keypair or Mac-based nests remain.

- `chat-api.ts` (ChatApi) deleted — troop is the sole chat backend
- `OPENAPE_BRIDGE_TARGET` env var and `'chat' | 'troop'` config union removed
- `loadBridgeEnvFile` (Mac `~/Library/Application Support` env loader) removed
- Shared types (`PostedMessage`, `HistoryMessage`, `ContactView`, `ChatBackend`)
  moved into `troop-chat-api.ts`; `TroopChatApi` is now the only backend class
- `DEFAULT_ENDPOINT` updated to `https://troop.openape.ai`
- Mac/launchd references removed from `identity.ts` and `cron-runner.ts`

Breaking: `OPENAPE_BRIDGE_TARGET` is no longer read. Docker nests that
explicitly set it in their compose env are unaffected (troop was already
selected that way). The env var is now silently ignored.
