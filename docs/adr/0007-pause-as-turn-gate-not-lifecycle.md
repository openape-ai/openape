# 0007 — Pause is a Turn-Execution Gate, Not a Process Lifecycle Action

- Status: Accepted (implemented #826/#831/#832, in active use)
- Deciders: Patrick Hofmann (owner), implemented by the werkstatt engine
- Related: [0001 — Single-Process Nest](0001-single-process-nest.md), [0005 — Flag-Gated Cutover](0005-flag-gated-cutover.md)

## Context

The owner needs to pause individual agents (or the whole fleet) — to stop an
agent that is misbehaving, to freeze work during an incident, to hold a nest
without tearing it down. Under the old per-agent process model the obvious
implementation is "stop the process": pause = `pm2 stop`, resume = `pm2 start`.

That instinct is wrong under [ADR 0001](0001-single-process-nest.md). In the
single-process nest there is no per-agent process to stop. Stopping the shared
`SessionHost` would pause everyone; killing one `AgentSession` would tear down
its WS, drop its token, and require a full respawn (and a token refresh) on
resume — turning a cheap, frequent operator action into an expensive,
failure-prone one. Pause also needs to survive a daemon restart and be issued
from the control plane (troop CLI / UI), not just locally.

The decision is *where pause lives* and *what it actually stops* — a question
that spans three boundaries (nest enforcement, registry/state persistence, troop
control plane) and was being captured only in scattered how-to docs.

## Decision

Pause is **state**, enforced at the turn choke-point — it never touches the
session's process or socket.

- **State, nest-authoritative.** The fleet-wide switch is one persisted flag in
  `nest-state.ts` (JSON next to the agent registry, so it survives a daemon
  restart). Per-agent pause is a field on the `AgentEntry` in `registry.ts`.
  `isAgentPaused(name)` ORs the two. The nest is the source of truth.
- **Enforced at the tick, read live.** `SessionHost.tickAll` checks
  `isAgentPaused` per session each turn. A paused agent is **still reconciled**:
  its `AgentSession` stays hosted, its WS stays connected, its token keeps
  refreshing. Only *turn execution* (scheduled and inbound-message turns) is
  skipped. Because the flag is read live at each turn, pause takes effect — and
  resume reverts — with no respawn.
- **Commanded by the control plane.** troop sends a `set-pause` frame over the
  existing nest↔troop WS; `handleSetPause` performs an in-process registry/state
  write. The `ape-troop` CLI and the troop UI are the issuers; the nest is the
  only enforcer.

## Consequences

**Positive**

- Pause/resume is cheap and instant: no process kill, no WS teardown, no token
  refresh, no respawn latency. Consistent with the single-process model rather
  than fighting it.
- A paused agent stays *connected and observable* — it can be resumed mid-second
  and the operator still sees it as hosted, distinct from a stranded/dead agent.
- Survives daemon restart (persisted state) and is driveable remotely through the
  existing control-plane channel; no new transport.

**Negative / risks**

- A paused agent still holds its WS and refreshes its token — it consumes a slot
  and a connection while doing no work. This is deliberate (cheap resume) but
  means "paused" is not "free".
- The pause check is a choke-point that every turn path must funnel through.
  Scheduled turns and inbound-message turns both honor it today; any *new* turn
  entry point must call `isAgentPaused` or it will silently bypass pause.
- Two scopes (nest-wide flag, per-agent field) OR together. A nest-wide pause
  masks per-agent state, so resuming one agent while the fleet is paused is a
  no-op until the fleet is resumed — intended, but a foreseeable operator
  surprise.

## Alternatives considered

- **Pause = stop the process/session** — rejected: there is no per-agent process
  under [ADR 0001](0001-single-process-nest.md); killing the `AgentSession` drops
  the WS and token and forces an expensive respawn + refresh on resume.
- **Pause state in the control plane (troop), nest queries it** — rejected: makes
  the nest's turn loop depend on a live troop round-trip and breaks if troop is
  unreachable; the nest must be able to enforce pause autonomously from local
  state.
