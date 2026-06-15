# 0005 — Flag-Gated Cutover from pm2 to the In-Process SessionHost

- Status: Accepted (owner-approved direction, 2026-06-14; in active use through M2)
- Deciders: Patrick Hofmann (owner), implemented by the werkstatt engine
- Related: [0001 — Single-Process Nest](0001-single-process-nest.md), `.claude/plans/single-process-nest.md` (M2/M4)

## Context

[ADR 0001](0001-single-process-nest.md) decides the *what*: collapse the per-agent
process fleet into one nest process that hosts N `AgentSession` objects. It does
not decide *how to migrate there safely*. That migration is the load-bearing
engineering decision the M2 work actually runs on — nearly every M2 PR is labelled
"flag-gated" — yet it had no record of its own.

The risk in a rewrite of the agent execution model is a big-bang cutover: replace
pm2 with the in-process host in one PR, discover at runtime that error isolation,
WS lifecycle, secret materialization, or token refresh behaves differently than
the per-agent bridge, and have no fast path back. The bridge's `pumpOnce` loop is
proven in production across 13 agents; the in-process path is new and was built
against a no-op placeholder before the real runtime existed.

## Decision

The in-process `SessionHost` ships alongside pm2 behind a single feature flag,
`OPENAPE_NEST_INPROCESS`, and is **default-off** until proven.

- Both `Pm2Supervisor` and `SessionHost` implement a shared `AgentSupervisor`
  interface (`apps/openape-nest/src/index.ts`). The nest picks one at startup by
  the flag; everything downstream (reconcile, tick, shutdown) is written against
  the interface, so the two paths never fork the call sites.
- With the flag unset the nest behaves exactly as before (pm2 spawns per-agent
  bridges). Setting `OPENAPE_NEST_INPROCESS=1` swaps in the `SessionHost` with the
  real agent-runtime factory.
- Each M2 increment lands behind this flag and is independently revertable. The
  flag-off path is the safety net: any regression in the in-process path is
  contained to operators who opted in, and the production fleet keeps running on
  pm2.
- **M4 is the cutover**: once the in-process path is proven (real WS, `runLoop`,
  tool-time `sudo` drop per [ADR 0004](0004-tool-time-isolation-sudo-self-materialize.md)),
  in-process becomes the default and pm2 — the supervisor, ecosystem/start.sh
  generation, and the per-agent Node processes — is deleted. The flag is retired
  in the same step; it is a migration scaffold, not a permanent config knob.

## Consequences

**Positive**

- No big-bang. The new execution model is exercised in production incrementally
  while the proven pm2 path remains one env var away.
- Reverting any single M2 PR returns to a working flag-gated state; reverting the
  M4 cutover PR returns to the flag-gated M2 state (pm2 still in the image).
- The shared `AgentSupervisor` interface keeps the two paths from diverging at the
  call sites and forces the in-process host to satisfy the same lifecycle contract
  pm2 already meets.

**Negative / risks**

- A dual-path window: both the pm2 path and the in-process path must keep working
  until M4. Two execution models coexist in the tree (and some runtime logic — the
  inbound-chat choke-point — is mirrored between `bridge.ts` and the nest factory),
  which is real carrying cost. The flag is explicitly temporary to bound it.
- Default-off means the in-process path gets no production exposure unless an
  operator opts in; proving it requires deliberately enabling the flag on a real
  nest, not just passing CI.
- A flag that outlives its purpose becomes permanent accidental complexity. The
  decision is that M4 deletes both pm2 and the flag together — the flag must not
  survive the cutover.

## Alternatives considered

- **Big-bang replacement** — rejected: no fast rollback if the new model misbehaves
  in production; the per-agent bridge's behavior is only fully knowable at runtime.
- **Long-lived flag (keep both paths indefinitely)** — rejected: permanent dual
  maintenance and two divergent execution models; the flag is a migration scaffold
  to be removed at M4, not a supported configuration.
</content>
</invoke>
