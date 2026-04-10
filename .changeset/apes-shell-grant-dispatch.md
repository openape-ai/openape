---
'@openape/apes': minor
---

feat(apes): grant flow integration for the interactive REPL (M4 of ape-shell interactive mode)

Every line a user types in `ape-shell` is now gated through the apes grant flow **before** it reaches the persistent bash pty. Adapter-backed commands (single-token, matching a shapes adapter) get a structured grant with resource chain and permission. Compound commands, commands without an adapter, or lines where adapter resolution fails fall back to a generic `ape-shell` session grant. Existing timed/always session grants for the same target host are reused.

Refactors `verifyAndExecute` in `packages/apes/src/shapes/grants.ts` into three exported pieces:

- `verifyAndConsume(token, resolved)` — verifies the JWT, checks authorization details against the resolved command, and marks the grant as consumed on the IdP. Does NOT execute anything.
- `executeResolvedViaExec(resolved)` — runs the resolved command via `execFileSync` with inherited stdio (the legacy one-shot path).
- `verifyAndExecute(token, resolved)` — preserved as before; composes the two above.

The interactive REPL calls `verifyAndConsume` and then writes the original line to bash's pty, so execution happens inside the REPL's persistent shell state instead of a fresh child. The one-shot `apes run --shell` path keeps using `verifyAndExecute` and is unchanged.
