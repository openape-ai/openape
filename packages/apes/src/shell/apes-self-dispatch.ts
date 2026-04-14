import { basename } from 'node:path'
import type { ParsedShellCommand } from '../shapes/shell-parser.js'

/**
 * Subset of `apes` subcommands that remain grant-gated even when invoked
 * as self-dispatches from inside an ape-shell context. These are the
 * three categories where the shell-grant layer adds real security value
 * that isn't duplicated by server-side auth gates or local-file-only
 * semantics:
 *
 *   - `run`   — spawns arbitrary executables, the core of the grant system
 *   - `fetch` — forwards the bearer token to a user-specified URL
 *   - `mcp`   — binds a network port and serves a persistent API
 *
 * Every other `apes <subcmd>` either reads state, mutates the user's own
 * local config, or talks to the IdP through endpoints that are already
 * scoped by the auth token — gating them in the shell is redundant
 * friction, and under 0.9.0's async-default grant flow it actively
 * breaks `apes grants run <id>` via recursion (the polling call itself
 * creates a new grant, cascading indefinitely).
 *
 * This is the single source of truth shared by both dispatch paths:
 *   - Interactive REPL: `shell/grant-dispatch.ts` → `requestGrantForShellLine`
 *   - One-shot `ape-shell -c`: `commands/run.ts` → `runShellMode` (which
 *     receives the bash-c-wrapped command after `rewriteApeShellArgs`
 *     rewrites `ape-shell -c "<cmd>"` into `apes run --shell -- bash -c <cmd>`)
 *
 * Keep this list in sync with the blocklist snapshot test in
 * `shell-grant-dispatch.test.ts` — the tripwire that forces a review
 * decision whenever a new top-level apes subcommand is added.
 */
export const APES_GATED_SUBCOMMANDS = new Set(['run', 'fetch', 'mcp'])

/**
 * Returns true if the parsed shell command is an `apes <subcmd>`
 * invocation that should bypass the grant flow entirely. Non-apes
 * binaries, compound lines (pipes, &&, etc.), and subcommands in
 * `APES_GATED_SUBCOMMANDS` all return false so they stay on the normal
 * grant path.
 *
 * The caller (either `requestGrantForShellLine` for the REPL path or
 * `runShellMode` for the one-shot path) is responsible for parsing the
 * input string and passing the resulting ParsedShellCommand here.
 */
export function isApesSelfDispatch(parsed: ParsedShellCommand | null | undefined): boolean {
  if (!parsed || parsed.isCompound)
    return false
  const invokedName = basename(parsed.executable)
  if (invokedName !== 'apes' && invokedName !== 'apes.js')
    return false
  const subCommand = parsed.argv[0]
  if (!subCommand)
    return false
  return !APES_GATED_SUBCOMMANDS.has(subCommand)
}
