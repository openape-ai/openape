---
'@openape/apes': minor
---

Add `--bridge-model` flag to `apes agents spawn` and `APE_CHAT_BRIDGE_MODEL` env-var support. Lets you spawn a bridged agent against a LiteLLM proxy that doesn't route the bridge's built-in default (`claude-haiku-4-5`) — e.g. a proxy fronting only ChatGPT subscription needs `gpt-5.4`. Without this the bridge daemon would 404 on every chat message because the proxy doesn't know the default model name.
