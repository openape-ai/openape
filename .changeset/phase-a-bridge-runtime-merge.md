---
'@openape/chat-bridge': minor
'@openape/apes': minor
---

Phase A of the architecture simplification (#sim-arch): merge the chat-bridge daemon and the per-turn agent runtime into a single in-process loop.

The bridge previously spawned `apes agents serve --rpc` as a long-lived stdio JSON-RPC subprocess and dispatched each turn through it. Now it imports `runLoop` from `@openape/apes` directly. Same loop, no IPC overhead, no second process to keep alive. Per-thread message history that used to live in the subprocess's `RpcSessionMap` now lives on each `ThreadSession` itself.

`@openape/apes` exposes the runtime surface for in-process use:

- `runLoop`, `RpcSessionMap` (classes/functions)
- `ChatMessage`, `RunOptions`, `RunResult`, `RuntimeConfig`, `RunStreamHandlers`, `TraceEntry`, `ToolDefinition` (types)
- `taskTools`, `TOOLS` (helpers)

The `apes agents serve --rpc` command is preserved for backwards compatibility with bridge versions <1.3 that still spawn it via stdio.

Net effect: one process per agent (the bridge), instead of two (bridge + serve). Faster turns (no IPC marshaling), simpler crash semantics, cron tasks share the same in-process runtime.
