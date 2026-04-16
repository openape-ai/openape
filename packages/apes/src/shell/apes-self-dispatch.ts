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
  if (!APES_GATED_SUBCOMMANDS.has(subCommand))
    return true
  // `apes run --as <user>` has its own internal escapes-audience grant
  // flow (runAdapterMode delegates to runAudienceMode('escapes', ...)).
  // Double-gating it through the ape-shell session-grant layer would
  // fall through to a generic session grant that never reaches escapes.
  // Let it self-dispatch so the inner apes process handles elevation.
  if (subCommand === 'run' && parsed.argv.includes('--as'))
    return true
  return false
}

/**
 * Result of checking a parsed shell command for a leading `sudo` token.
 * The `reason` doubles as a ready-to-print error message so the REPL
 * and one-shot paths emit byte-identical text.
 */
export interface SudoRejection {
  reason: string
}

/**
 * Returns a rejection hint if the parsed line is a simple, non-compound
 * command whose leading executable is `sudo`. `sudo` is not available
 * inside ape-shell (the wrapper user is not in /etc/sudoers by design),
 * so agents and humans should use the explicit
 * `apes run --as root -- <cmd>` flow which routes through the escapes
 * setuid binary.
 *
 * Compound lines (pipes, &&, etc.) return null so the downstream
 * session-grant path can still negotiate a grant and bash surfaces the
 * real sudo error. We only short-circuit the leading-sudo case which is
 * the agent footgun.
 *
 * Shared by both dispatch paths:
 *   - Interactive REPL: `shell/grant-dispatch.ts` → `requestGrantForShellLine`
 *   - One-shot `ape-shell -c`: `commands/run.ts` → `runShellMode`
 */
export function checkSudoRejection(parsed: ParsedShellCommand | null | undefined): SudoRejection | null {
  if (!parsed || parsed.isCompound) return null
  if (basename(parsed.executable) !== 'sudo') return null
  const rest = parsed.argv.join(' ').trim()
  const hint = rest.length > 0
    ? `apes run --as root -- ${rest}`
    : 'apes run --as root -- <cmd>'
  return {
    reason: `sudo is not available in ape-shell. Use \`${hint}\` for privileged commands.`,
  }
}
