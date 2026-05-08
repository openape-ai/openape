---
'@openape/chat-bridge': major
---

**BREAKING**: chat-bridge now spawns `apes agents serve --rpc` instead of `pi --mode rpc`. Drops the `@mariozechner/pi-coding-agent` runtime dependency entirely — the bridge runs against `@openape/apes` (≥ 0.32.0) which embeds a LiteLLM-backed runtime with the OpenApe tool catalog.

Env vars changed:
- removed: `APE_CHAT_BRIDGE_PI_BIN`, `APE_CHAT_BRIDGE_PROVIDER`
- renamed: `APE_CHAT_BRIDGE_MODEL` (default now `claude-haiku-4-5` instead of `gpt-5.4`)
- new: `APE_CHAT_BRIDGE_APES_BIN` (default: `apes` on `$PATH`), `APE_CHAT_BRIDGE_TOOLS` (comma-separated, default empty), `APE_CHAT_BRIDGE_MAX_STEPS` (default 10), `APE_CHAT_BRIDGE_SYSTEM_PROMPT` (default: friendly assistant)

Migration on existing agent hosts: re-run `apes agents spawn --bridge <name>` so the launchd plist + start.sh pick up the new env defaults.
