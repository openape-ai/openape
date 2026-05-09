---
'@openape/apes': minor
---

`apes nest install --bridge-model <name>` persists the default bridge model used by every subsequent `apes [nest|agents] spawn --bridge`. Writes `APE_CHAT_BRIDGE_MODEL=<name>` into `~/litellm/.env` (the file `resolveBridgeConfig()` already reads at spawn time). Without this flag, the chat-bridge falls back to its built-in default `claude-haiku-4-5`, which 400s every chat-completion request when the user's LiteLLM proxy fronts only ChatGPT (or only Anthropic etc.).
