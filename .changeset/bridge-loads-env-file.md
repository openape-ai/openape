---
'@openape/chat-bridge': patch
---

Bridge loads its `.env` file at startup. Phase D removed the `start.sh` wrapper that used to `source` this file before exec'ing the bridge; the Nest supervisor invokes the bridge directly. Without start.sh nobody loaded `~/Library/Application Support/openape/bridge/.env`, so `APE_CHAT_BRIDGE_MODEL` was never set and the bridge bailed at boot with the new fail-fast (#375). Bridge now reads + merges the file itself before checking required vars; explicit env still wins over the file (no overwrite of `process.env[key]` if already set).
