# 0002 — `@openape/ape-agent` as a dual bin + library package

- Status: Accepted (implemented M2, 2026-06-14; see PRs #684, #685, #687, #696)
- Deciders: Patrick Hofmann (owner), implemented by the werkstatt engine
- Related: `.claude/plans/single-process-nest.md`, [ADR 0001](0001-single-process-nest.md)

## Context

ADR 0001 collapses the nest from ~26 processes to one: a `SessionHost` holds N
`AgentSession` objects in-process instead of spawning one bridge Node process per
agent. That requires the nest to **import** the agent runtime, not spawn it.

`@openape/ape-agent` was historically a bin-only package — it shipped executables
(the bridge, cron runner) and exposed no library entry point, so the nest had no
supported way to reference the agent runtime in-process. This was the real
blocker in front of the single-process architecture, not the supervisor: without
a library surface, `SessionHost` could only ever shell out, which is the model
ADR 0001 removes.

Two non-obvious hazards surfaced while making the package importable:

1. The tsup build applied a global `banner: { js: '#!/usr/bin/env node' }`. Once
   the package also emitted a library bundle, that shebang landed mid-bundle in
   the library `.mjs`; downstream bundlers (vitest/rolldown) fail hard on
   `Invalid Character '!'` because Vite injects `import.meta.env=…` ahead of it.
2. Re-exporting a *value* (e.g. `readConfig`) from `bridge.ts` through the
   library entry pulls `bridge.ts`'s top-level `main().catch()` into the library
   bundle, so merely importing the package runs `process.exit(1)` (seen as an
   unhandled rejection under vitest). A type-only re-export hides this latent.

## Decision

Ship `@openape/ape-agent` as **both** a CLI and a library from one package:

- tsup uses `defineConfig([...])` with **two configs** — the bin entries keep the
  `#!/usr/bin/env node` shebang banner; the library `index.mjs` is built with
  **no banner** and `dts: true`. The library config sets `clean: false` so it
  does not wipe the bin outputs.
- `package.json` declares `exports`/`main`/`types` pointing at the library entry.
- The library entry exports only **side-effect-free** symbols (`AgentSession`,
  `BridgeConfig`, `readConfig`, `readAgentIdentity`, `AgentIdentity`). Runtime
  entrypoints with top-level side effects (`bridge.ts`'s `main()`) are kept out
  of the library graph. The bin path keeps its behaviour byte-for-byte via
  default arguments (e.g. `readConfig(env = process.env)`).
- The split is verified, not assumed: the library bundle is checked to contain no
  shebang (`head -c2` ≠ `#!`) and no `process.exit`.

`@openape/nest` takes a `workspace:*` dependency on `@openape/ape-agent` and
constructs `AgentSession` across the package boundary inside its real
`HostedSession` factory.

## Consequences

**Positive**

- The nest hosts the actual agent runtime in-process — the precondition for the
  whole single-process architecture (ADR 0001).
- One source of truth for agent-runtime logic: no second copy of the WS URL rule,
  the config parser, or the identity/auth.json rules in the nest.
- The bin path is unchanged; the CLI continues to ship from the same package.

**Negative / risks**

- The package now has two build outputs and a sharper invariant: the library
  graph must stay free of top-level side effects. A future value re-export from a
  side-effecting module silently re-breaks importing the package — the
  shebang/`process.exit` build assertions guard against regressing this.
- A library consumer (the nest) and a process consumer (the bridge) now share one
  package; a change that suits one must not regress the other (mitigated by the
  `env`/`home` injection-with-default pattern).

## Alternatives considered

- **Keep ape-agent bin-only; nest shells out per agent** — rejected: that is the
  per-process model ADR 0001 removes; an in-process host cannot `import` a
  bin-only package.
- **Extract the runtime into a new third package** — rejected for now: the bridge
  and the library want the same code; a dual-entry single package avoids a
  premature split (YAGNI). Revisit if the bin and library surfaces diverge.
</content>
</invoke>
