import { quote } from 'shell-quote'
import { authFileFor  } from './config.js'
import type { GateConfig } from './config.js'

/**
 * What the hook should do with a tool call. `pass` leaves the call untouched,
 * `rewrite` replaces the command, `block` rejects it with a reason the agent
 * sees.
 */
export type GateDecision =
  | { kind: 'pass' }
  | { kind: 'rewrite', command: string }
  | { kind: 'block', reason: string }

/**
 * Env prefix the wrapper emits. It doubles as the marker that recognises an
 * already-wrapped command: a plain `startsWith` on this exact prefix cannot be
 * spoofed into a false *negative* the way a substring search could, because
 * only a command that genuinely begins with our wrapper matches.
 */
const WRAP_PREFIX = 'APE_WAIT=1 APES_AUTH_FILE='

/**
 * Build the ape-shell wrapping for one command.
 *
 * `APE_WAIT=1` makes apes block until the grant is decided rather than exiting
 * with the pending-grant code, and `APES_AUTH_FILE` selects the requesting
 * agent's identity. Note that apes resolves that variable into a module-level
 * constant, so it is process-global — which is exactly why it can only carry
 * one identity and why the direct-API path does not use it.
 */
export function wrapWithApeShell(command: string, apeShellPath: string, authFile: string): string {
  return `${WRAP_PREFIX}${authFile} ${apeShellPath} -c ${quote([command])}`
}

export function isAlreadyWrapped(command: string): boolean {
  return command.startsWith(WRAP_PREFIX)
}

/**
 * Decide what happens to one `exec` tool call.
 *
 * Unmapped agents are blocked rather than passed through: policy belongs to
 * the owner, and an agent nobody assigned an identity to has no way to request
 * a grant at all. Failing open here would make the gate depend on config
 * completeness, which is the one thing an operator forgets.
 */
export function decideExec(params: {
  agentId: string | undefined
  command: unknown
  config: GateConfig
}): GateDecision {
  const { agentId, command, config } = params

  if (agentId === undefined) {
    return { kind: 'block', reason: 'openape-grant-gate: tool call carried no agent id — exec blocked (fail-closed).' }
  }

  const authFile = authFileFor(config, agentId)
  if (authFile === undefined) {
    return {
      kind: 'block',
      reason: `openape-grant-gate: no operator identity mapped for agent "${agentId}" — exec blocked (fail-closed). Add it to the plugin's \`agents\` config.`,
    }
  }

  if (typeof command !== 'string' || command.trim().length === 0) return { kind: 'pass' }
  if (isAlreadyWrapped(command)) return { kind: 'pass' }

  return { kind: 'rewrite', command: wrapWithApeShell(command, config.apeShellPath, authFile) }
}
