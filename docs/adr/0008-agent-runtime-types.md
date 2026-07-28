# 0008 — Per-Agent Runtime Types (`bridge` | `openclaw` | native `ThreadSession`)

- Status: Accepted (in active use; end-state default runtime owner-pending)
- Date: 2026-06-22
- Related: [0001 — Single-Process Nest](0001-single-process-nest.md),
  [0004 — Tool-Time Isolation](0004-tool-time-isolation-sudo-self-materialize.md),
  [0006 — In-Process Turn Dispatch via ThreadSession](0006-in-process-turn-dispatch-thread-session.md)

## Context

ADR 0001 framed the single-process nest as collapsing the per-agent pm2 bridge
fleet into in-process `AgentSession`/`ThreadSession` objects. Since then a
**second in-process runtime** appeared that ADR 0001 did not anticipate:
agents now carry a `runtimeType: 'bridge' | 'openclaw'` field
(`apps/openape-nest/src/lib/registry.ts`), and the nest routes each agent to one
of **three** distinct turn-executors:

1. **`bridge`** (default / `null`) — the legacy per-agent pm2 daemon
   (`@openape/ape-agent`). Full tools, isolation via the dedicated OS process.
   `isDaemonRuntime()` keeps these on pm2 unless `OPENAPE_NEST_INPROCESS=1`.
2. **`openclaw`** — in-process, but **foreign one-shot**: each accepted message
   `exec`s `openclaw agent --local` for a single turn. No daemon, no
   `ThreadSession`. Tool isolation is **already** dropped to the agent OS user
   via `sudo -u` under `OPENAPE_BYPASS_APE_SHELL=1` (#815/#862).
3. **native `ThreadSession`** — in-process, per-`roomId:threadId`, the path ADR
   0006 describes. Currently **text-only** (`tools: []`,
   `agent-runtime-session.ts`) because its `sudo -u` tool-drop (ADR 0004 / M3)
   isn't built yet.

The routing rule lives in one place (`runtime-routing.ts`) so the pm2 supervisor
skip and the SessionHost selection agree. What is **not** written down anywhere
but code comments: why three runtimes coexist, how they differ in isolation
maturity, and which one is the intended end-state.

## Decision

Agents declare their turn-executor via `runtimeType`; the nest dispatches
accordingly through the single `runtime-routing.ts` rule. The three runtimes are
treated as a **migration ladder, not a permanent menu**:

- `bridge` is legacy and exits with M4 (pm2 removal, ADR 0005).
- `openclaw` and native `ThreadSession` are both in-process SessionHost
  citizens; the SessionHost owns all agents under `OPENAPE_NEST_INPROCESS`, and
  only the non-daemon runtimes otherwise.
- Tool-time isolation (ADR 0004) is per-runtime: `openclaw` has it; native
  `ThreadSession` ships text-only until M3 restores tools behind the same
  `sudo -u` drop. **No runtime runs side-effecting tools as root.**

The boundary is the contract: a runtime is selected only by `runtimeType`, every
runtime resolves owner/bearer/chatPoster identically, and a runtime may enable
tools **only** once its isolation drop is in place.

## Consequences

- **Coherence guard:** text-only native `ThreadSession` is a deliberate,
  documented safety floor (tools off until isolation lands), not an unfinished
  half-state. Anyone enabling `tools` on that path without the `sudo -u` drop is
  regressing ADR 0004 — that is now reviewable against a written decision.
- **Open question (owner-pending):** which in-process runtime is the *default
  end-state* after M4 — native `ThreadSession` (ADR 0006's direction) or
  `openclaw` (already tool-isolated, but a foreign one-shot model with no
  per-thread history)? Until the owner decides, both are supported and an agent's
  `runtimeType` is explicit. This ADR records the fork; it does not resolve it.
- **Risk:** three turn-execution code paths is real surface. Keeping the
  selection centralised in `runtime-routing.ts` and the per-runtime context in
  one factory (`resolveAgentRuntimeContext`) bounds the duplication; a fourth
  runtime should reuse the same shape, not add a parallel router.
