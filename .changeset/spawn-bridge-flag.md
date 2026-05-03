---
"@openape/apes": minor
---

Add `apes agents spawn --bridge` to install the openape-chat-bridge daemon for the spawned agent. Drops a launchd plist + start script + `~/.pi/agent/.env` into the agent's home, so the agent auto-answers chat.openape.ai messages by forwarding them to a local LLM CLI (default: pi). LITELLM_API_KEY + LITELLM_BASE_URL default from `~/litellm/.env` (the spawning user's hand-crafted proxy setup); override via `--bridge-key` / `--bridge-base-url`. `apes agents destroy` already cascades cleanup via `launchctl bootout user/$UID_OF` + `rm -rf $HOME_DIR`, so no destroy changes were needed.
