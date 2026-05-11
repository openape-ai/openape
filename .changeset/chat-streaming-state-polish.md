---
"@openape/ape-agent": minor
---

Chat-bridge: agent messages stream cleanly without "(edited)" artefacts + tool-call visibility.

**Before**: every agent reply showed "(edited)" because the bridge posted a `…` placeholder and then PATCHed body once per ~300ms while LLM tokens streamed. Each PATCH bumped `edited_at`. Plus there was no signal *what* the agent was doing during tool calls — the user just saw "…" hang for seconds.

**After**: messages carry a `streaming` flag distinct from `edited_at`. While streaming:
- Empty placeholder renders as a 3-dot typing cursor (pure CSS animation)
- Body updates from token streams don't bump `edited_at`
- Tool calls set `streamingStatus` (e.g. `🔧 time.now`) shown as italic subtitle under the cursor — cleared on tool-result / stream-end
- Web-push fires once on stream-end, not on every chunk

The `(edited)` badge only renders for human edits made >2s after creation (the 2s window swallows the stream-end PATCH that lands milliseconds after the placeholder).

Display-name extraction also fixed: agent emails like `igor30-cb6bf26a+patrick+hofmann_eco@id.openape.ai` now render as just `igor30` with the 🤖 badge — same DDISA identity, much more readable.

Schema migration (idempotent ALTERs): `messages.streaming INTEGER NOT NULL DEFAULT 0` + `messages.streaming_status TEXT`. Existing messages back-compat: `streaming=0`, `streaming_status=null`.
