# 0001 — Single-Process Nest (collapse ~26 processes to 1)

- Status: Accepted (owner-approved direction, 2026-06-14; M2 code merged + M3 openclaw tool-drop on main, #815; M4 cutover + native ThreadSession tool-drop pending)
- Deciders: Patrick Hofmann (owner)
- Related: `.claude/plans/single-process-nest.md`

## Context

A nest runs an agent company. The historical model is per-agent: each agent gets
its own OS user, its own pm2 daemon, a bridge Node process, a long-lived troop
WebSocket, and a cron `setInterval`. At 13 agents that is ~26 long-lived
processes. pm2's `max_restarts:10` let it give up on an agent after 10 crashes,
producing stranded agents (the #659 cap-lift mitigates the symptom, not the
model). The agent loop (`runLoop` from `@openape/apes`) is already callable
in-process — the per-process layout is historical, not necessary.

The per-process model is expensive to reason about ("the bridge is dead and not
coming back" is a whole error class), and the supervision (pm2 reconcile, restart
caps, ecosystem.config generation) is accidental complexity that exists only
because each agent is a separate OS process.

## Decision

The nest hosts the whole agent company as **one** process. A `SessionHost` holds
N `AgentSession` objects in-process; each session keeps its own identity/token
and its own cheap WS socket (N sockets in one process — no troop-side
multiplexing), and a single central scheduler tick iterates all sessions in place
of 13 `setInterval`s. LLM orchestration, WS, and token handling run in the nest.

The OS users stay, but isolation moves from process-time to **tool-time**: only
side-effecting tool calls (bash/file) drop to `sudo -u <agent>`, where the agent
self-materializes its own secrets (it owns the x25519 key). The nest holds no
plaintext secrets and no per-agent env maps.

pm2 and the per-agent Node processes are removed. The cutover is feature-flagged
(`OPENAPE_NEST_INPROCESS`) so pm2 stays as a safety net until the in-process path
is proven; M4 makes in-process the default and deletes pm2.

## Consequences

**Positive**

- ~26 long-lived processes collapse to 1; pm2, restart caps, and per-agent
  ecosystem/start.sh generation disappear as a concept.
- Per-session failures are caught and retried in-process (as `pumpOnce` does
  today); the container's `restart:unless-stopped` covers a process-fatal bug.
  Net more robust than 13 independent pm2 supervisors.
- Live chat stays fast (sessions are warm, no per-message cold start).
- The nest never holds plaintext secrets; secret scoping is preserved by the
  tool-time `sudo` drop rather than by process boundaries.

**Negative / risks**

- A single process-fatal bug can take all agents down at once (rare; container
  restart is the backstop). This trades 13 isolated blast radii for 1.
- In-process hosting needs disciplined error isolation per session — every
  session loop, tick, start/stop, and reconcile path must contain its own
  failures or one agent's fault strands the rest.
- The lifecycle/observability surface (reconcile serialization, stranded retry,
  stop-on-shutdown) had to be built against a no-op placeholder before the real
  runtime existed; it must be re-validated once a session actually opens a WS and
  runs `runLoop`, since a stub `start()` exercises none of it.

## Alternatives considered

- **Ephemeral per-task workers** — rejected: cold start makes live chat sluggish.
- **Status quo + watchdog** — rejected: keeps all the per-process complexity and
  only papers over the stranding symptom.
- **troop-side WS multiplexing** — rejected: sockets are cheap; multiplexing
  would widen scope into the troop protocol for no benefit.
</content>
</invoke>
