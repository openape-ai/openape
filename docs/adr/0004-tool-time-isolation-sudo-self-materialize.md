# 0004 — Tool-Time Isolation via `sudo -u <agent>` + Secret Self-Materialization

- Status: Accepted (owner-approved direction, 2026-06-14; openclaw runtime path implemented on main, #769/#808/#815, 2026-06-19; native `ThreadSession` tool-drop pending, security-gated)
- Deciders: Patrick Hofmann (owner)
- Related: [0001 — Single-Process Nest](0001-single-process-nest.md), `.claude/plans/single-process-nest.md` (M0 spike, M3)

## Context

ADR 0001 collapses ~26 per-agent processes into one nest process. That removes
the boundary that used to scope each agent's secrets: today each agent runs as
its own OS user in its own process, so a secret only ever lives in that process's
environment. Once one nest process hosts all agents, the question is how agent A's
side-effecting tool calls (bash/file) stay unable to read agent B's secrets or
home — without reintroducing a process per agent.

The naive answer — the nest keeps a per-agent env map and passes it as the `env`
block when it drops a tool to `sudo -u <agent>` — does not work. The M0 spike
(`scripts/spike-isolation.mjs`, 2026-06-14) found that **`sudo` strips the
environment**: both child processes saw the `"NONE"` fallback instead of the
token, because the parent's env does not survive the `sudo -u` transition. A nest
that tried to inject secrets that way would simply fail to deliver them — and to
even hold them, the nest (running as root) would have to keep every agent's
plaintext secrets in memory, making the single process a high-value target.

## Decision

Isolation moves from process-time to **tool-time**, and the nest holds **no**
secrets and **no** per-agent env maps.

- LLM orchestration, the troop WebSocket, and token handling run in the nest
  process (root).
- Only side-effecting tool calls (bash/file/shell) drop to the agent's OS user
  via `sudo -u <agent>`. Read-only / LLM-internal tools (http/time) need no drop.
- The dropped shell **self-materializes** its own secrets: the agent owns its
  x25519 key, so the wrapper unseals them itself, e.g.
  `sudo -u <agent> sh -c 'eval "$(apes secrets shell-export)"; <cmd>'`. The
  secret never crosses the nest's memory in the clear, and never rides through a
  `sudo` env block.
- The OS users from the old model **stay** — they exist now only to be the target
  of the tool-time drop, not to run a daemon.

The M0 spike proved both properties hold inside one process: self-materialize
yields the correct per-agent token (hash matches the holder map), and a
cross-read of another agent's `~/.config/openape/secrets.d` is "Permission
denied".

## Consequences

**Positive**

- The nest (root) never holds any agent's plaintext secret. Compromising the nest
  process does not directly yield the secret store; an attacker would still need
  each agent's key, which lives only in that agent's home.
- Secret scoping is preserved by the OS-user boundary at tool time, identical to
  what process isolation gave before, with no per-agent daemon.
- Simplifies the host: M2's `SessionHost` manages no env maps, and M3's tool
  wrapper is a single self-materialize shell form rather than per-call env
  plumbing.

**Negative / risks**

- Every side-effecting tool call pays a `sudo` + unseal cost. Acceptable: tool
  calls are coarse-grained relative to LLM turns.
- Correctness now hinges on classifying each tool as side-effecting (must drop)
  vs. read-only (need not). A misclassification that runs a side-effecting tool
  in-process as root would bypass isolation — the classification is a security
  boundary and must be tested adversarially (M3 `isolation.test.ts`).
- The OS users and per-agent home permissions must survive the M4 cutover that
  deletes pm2; `docker-entrypoint.sh` keeps recreating the users from the
  registry precisely so the drop target exists.

## Alternatives considered

- **Nest holds per-agent env maps, injects via `sudo` env block** — rejected:
  `sudo` strips the env (M0 finding), so it does not even deliver the secret, and
  it would force the root nest to hold every plaintext secret.
- **Drop isolation entirely (run tools in-process as root)** — rejected: removes
  the secret-scoping property that the per-process model provided; one agent's
  tool could read another's home and tokens.
