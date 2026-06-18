# 0003 — Per-agent auth home injection in `@openape/cli-auth`

- Status: Accepted (owner-approved + merged 2026-06-15, PR #709)
- Deciders: Patrick Hofmann (owner), implemented by the werkstatt engine
- Related: `.claude/plans/single-process-nest.md`, [ADR 0001](0001-single-process-nest.md), [ADR 0002](0002-ape-agent-dual-bin-library.md)

## Context

ADR 0001 collapses the per-agent processes into one Nest daemon that hosts N
`AgentSession`s. To open its troop WebSocket each session needs a *fresh* IdP
token for *its own* agent. The refresh path lives in the published, shared
`@openape/cli-auth` package: `ensureFreshIdpAuth` (and the storage helpers
`getConfigDir`/`getAuthFile`/`loadIdpAuth`/`saveIdpAuth`) always resolve the
*current process* home (`OPENAPE_CLI_AUTH_HOME` env, else `~/.config/apes`).

In the old per-process model that was correct — one process == one agent == one
home. In the single-process model it is wrong: one daemon must read and refresh
each agent's own `~/.config/apes/auth.json`. Reading the daemon's own home would
hand every agent the same identity; reading an agent's `access_token` directly
(bypassing `ensureFreshIdpAuth`) would skip the refresh that prevents the 1-hour
agent-token crash loop. Neither is acceptable, and `cli-auth` is a published,
security-sensitive package, so the change had to be minimal and owner-gated.

## Decision

Thread an **optional** `authHome` parameter through `ensureFreshIdpAuth` and the
IdP-auth storage helpers. When provided, auth state resolves to
`<authHome>/.config/apes` and takes precedence over `OPENAPE_CLI_AUTH_HOME`, so
the per-agent home wins inside one process. When omitted, behaviour is
byte-identical to before (env home, else process `~/.config/apes`).

The parameter changes **only which home is read/written** — no token, signature,
refresh, or storage-format logic changes. The Nest passes each hosted agent's
registry `home` so refresh runs against that agent's own credentials and writes
the refreshed token back to the same place.

## Consequences

**Positive**

- The single Nest daemon can refresh and use a distinct IdP token per hosted
  agent through the canonical refresh path — no token/home logic is duplicated or
  re-implemented in the Nest, and the 1-hour refresh guard is preserved.
- Default-path callers (every existing CLI) are unaffected; the seam is additive
  and opt-in.

**Negative / risks**

- A shared published auth library now accepts an arbitrary home, widening its
  surface: a caller that passes the wrong `authHome` reads/writes another agent's
  auth file. The mitigation is that the Nest is the only caller that passes it and
  derives it from the trusted registry, and the OS-user file permissions still
  gate actual access at the filesystem layer.
- The precedence rule (`authHome` > `OPENAPE_CLI_AUTH_HOME` > process home) is an
  invariant later refactors must preserve; it is covered by storage tests.

## Alternatives considered

- **Read the agent's `access_token` directly from its `auth.json`** — rejected:
  bypasses `ensureFreshIdpAuth`, so a token expiring inside the 1-hour window
  strands the agent (the crash loop the refresh path exists to prevent).
- **Have the Nest set `OPENAPE_CLI_AUTH_HOME` per call** — rejected: it is
  process-global env, unsafe to mutate while N sessions share one process.
- **Fork the refresh logic into the Nest** — rejected: duplicates
  security-sensitive token handling across a package boundary (ADR 0002's whole
  reason for making `ape-agent` a library was to avoid exactly this).
