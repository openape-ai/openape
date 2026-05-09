---
'@openape/chat-bridge': minor
---

The chat-bridge no longer falls back to `claude-haiku-4-5` when `APE_CHAT_BRIDGE_MODEL` is unset — it now throws at startup with a pointer to the env file the user should set. The previous default silently misrouted on LiteLLM proxies fronting only ChatGPT (or only Anthropic), producing a `400 Invalid model name` response on every chat-completion request that was visible to the human only as a runtime error in the chat UI long after spawn. Failing fast at boot with a clear message is the correct user experience.

`apes [nest|agents] spawn --bridge` already writes the model into `~/Library/Application Support/openape/bridge/.env` based on `~/litellm/.env` (or `--bridge-model`), so this only affects setups where someone hand-launched the bridge without configuring it.
