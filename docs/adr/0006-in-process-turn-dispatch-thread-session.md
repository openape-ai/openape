# 0006 — In-Process Turn Dispatch via the Canonical `ThreadSession`

- Status: Accepted (owner-decided fork, 2026-06-15; A3 seam in active use, flag-gated)
- Deciders: Patrick Hofmann (owner), implemented by the werkstatt engine
- Related: [0001 — Single-Process Nest](0001-single-process-nest.md), [0004 — Tool-Time Isolation](0004-tool-time-isolation-sudo-self-materialize.md), [0005 — Flag-Gated Cutover](0005-flag-gated-cutover.md), `.claude/plans/single-process-nest.md` (M2 §A3, engine runs 13–15)

## Context

[ADR 0001](0001-single-process-nest.md) decides that one nest process hosts N
agent runtimes; [ADR 0005](0005-flag-gated-cutover.md) decides the safe migration
behind `OPENAPE_NEST_INPROCESS`. Neither decides **how an accepted inbound chat
message becomes a running LLM turn** inside the hosted session — the load-bearing
seam of M2's A3 work, and a fork the plan deliberately left open ("ThreadSession
*or* direct `runLoop`").

The first A3 seam (#736) shaped turn dispatch as `runTurn(message) → string|null`,
with the nest posting the returned reply via a `chatPoster`. Reading the bridge's
own `thread-session.ts` then surfaced the conflict: the canonical `ThreadSession`
the per-agent bridge runs is **self-posting** — it owns the `chat` backend, streams
its reply back to troop itself (placeholder → streaming PATCH → backfill), keeps
per-`${roomId}:${threadId}` history plus a hung-backend watchdog, and returns
**no text**. A return-text seam is therefore incompatible with reusing it.

Two coupled questions had to be answered together:

1. **Reuse the canonical `ThreadSession`, or call `runLoop` directly?** Direct
   `runLoop` fits the return-text seam 1:1 and is minimal, but has no per-thread
   history/backfill and no streaming — the hosted chat agent would have **no thread
   memory** and answers would appear all-at-once: a behavioral regression versus the
   bridge chat path, and a *second* runLoop code path that can drift.
2. **What runs inside the turn — tools or text-only?** The runtime executes as the
   nest's **root**. Per [ADR 0004](0004-tool-time-isolation-sudo-self-materialize.md)
   the `sudo -u <agent>` tool-drop is M3 and **not yet built**. Enabling the bridge's
   tools here before M3 would execute side-effecting tools as root — a privilege
   regression.

## Decision

In-process turn dispatch **reuses the canonical `ThreadSession`** and the seam is
reshaped to fire-and-forget, text-only until M3.

- The seam is `dispatchTurn(message: TroopMessage): void` — fire-and-forget, not
  `runTurn → string`. The `ThreadSession` owns the turn end-to-end and streams its
  own reply, so there is no reply for the nest to return or post. `resolveAgentRuntimeContext`
  keeps one `ThreadSession` per `${roomId}:${threadId}` in a `Map`, created on
  demand and enqueued onto — mirroring the bridge's `getOrCreateThread`.
- `chatPoster` is **refusal-only**: the prompt-injection refusal on the block path
  is the seam's single direct post. Accepted-message replies stream from the
  `ThreadSession`, never through `chatPoster`. This matches the bridge exactly
  (refusal via `chat.postMessage`, replies via the session).
- The in-process turn runs **text-only** (`tools: []`, raw system prompt) until M3
  lands the tool-drop. WS → parse → screen → dispatch → `runLoop` → streamed reply
  is fully functional and safe in this state; M3 restores tools behind the
  `sudo -u <agent>` boundary.
- The whole seam stays behind `OPENAPE_NEST_INPROCESS` ([ADR 0005](0005-flag-gated-cutover.md)).
  With the flag unset `dispatchTurn` is never wired and the pm2 path is byte-identical.

## Consequences

**Positive**

- **No drift, no regression**: one runLoop code path (the bridge's), full thread
  memory + streaming + watchdog for the hosted agent, identical to the proven
  per-agent chat path.
- The text-only deferral makes A3 shippable and safe *before* M3, decoupling
  "turns run in-process" from "tools run isolated" without ever opening a
  root-tool-exec window.
- Refusal-only `chatPoster` keeps the choke-point's one direct post explicit and
  small; everything else flows through the canonical session.

**Negative / risks**

- The runtime→`RuntimeConfig` mapping (`LITELLM_*` + model) is reconstructed in the
  nest factory, paralleling the bridge's `runtimeConfig()`. It is a second copy of
  that env→config shape and can drift silently if the bridge's changes; the parity
  is asserted by intent and comment, not enforced by a shared helper. A future
  consolidation (export the bridge's resolver) would remove the duplication.
- Text-only is a real (temporary) capability gap: until M3 the hosted agent cannot
  use tools, so flag-on E2E before M3 exercises chat only, not the full agent.
- Reusing the self-posting `ThreadSession` means the nest does **not** observe turn
  outcomes directly (no returned text) — diagnostics depend on the session's own
  logging forwarded through the nest log sink.

## Alternatives considered

- **Direct `runLoop` with return-text seam** — rejected: no thread memory, no
  streaming (behavioral regression vs. the bridge chat path) and a second runLoop
  path that can drift from the canonical one. The minimal-seam appeal did not
  outweigh the product regression.
- **Ship tools enabled now** — rejected: executes side-effecting tools as the
  nest's root before the [ADR 0004](0004-tool-time-isolation-sudo-self-materialize.md)
  tool-drop exists — a privilege regression. Tools wait for M3.
- **Defer A3 entirely until M3** — rejected: text-only dispatch is independently
  valuable and de-risks the WS→dispatch→reply path now; coupling it to M3 would
  stall M2 unnecessarily.
