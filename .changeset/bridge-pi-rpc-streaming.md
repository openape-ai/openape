---
"@openape/chat-bridge": minor
"@openape/apes": patch
---

`@openape/chat-bridge` rewritten to drive pi via its RPC mode (`pi --mode rpc`) instead of one-shot `pi --print` per message. One long-lived pi subprocess per chat room means the conversation now has memory across messages — "what's 7×6?" then "and ×2?" produces "84" not a confused "what do you mean ×2?". The agent's reply also visibly grows in real time as pi streams `text_delta` events: bridge posts a placeholder message and PATCHes it progressively (throttled ~300ms).

`@openape/apes`: bridge `start.sh` now always pulls `@openape/chat-bridge@latest` on boot, so restarting the launchd daemon picks up new bridge versions without manual intervention. Pi extension setup unchanged.
