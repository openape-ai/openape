import type { AuthData } from '../config.js'
import type { PtyBridge } from './pty-bridge.js'
import type { ShellSession } from './session.js'

/**
 * Injected dependencies for the meta-command handler. Keeping these behind
 * an explicit interface lets tests drive the handler with plain objects and
 * `vi.fn()` spies, no pty or auth file required.
 */
export interface MetaDeps {
  getBridge: () => PtyBridge
  resetBridge: () => Promise<void>
  session: ShellSession
  getAuth: () => AuthData | null
  targetHost: string
  isPending: () => boolean
  write: (s: string) => void
}

/**
 * Short one-line descriptions printed by `:help`. Ordered alphabetically so
 * the list stays stable as we add more commands.
 */
const HELP_ENTRIES: Array<[string, string]> = [
  [':help', 'Show available meta-commands.'],
  [':reset', 'Kill and respawn the bash child (preserves grants + audit).'],
  [':status', 'Show session, host, bash pid, and auth state.'],
]

/**
 * Format a millisecond duration as `Nh Nm Ns` with components omitted only
 * from the left. We always show seconds so zero-ish uptimes still read sanely.
 */
function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0)
    parts.push(`${hours}h`)
  if (hours > 0 || minutes > 0)
    parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)
  return parts.join(' ')
}

/**
 * Build the async handler invoked by `ShellRepl.onMetaCommand`. Return value
 * semantics match the REPL contract: `true` means the line was consumed and
 * the REPL should redraw the prompt; `false` would fall through to shell
 * dispatch, but every branch here currently returns `true`.
 */
export function createMetaCommandHandler(deps: MetaDeps): (line: string) => Promise<boolean> {
  return async (line: string) => {
    const trimmed = line.trim()

    if (trimmed === ':help') {
      deps.write('Available meta-commands:\n')
      for (const [name, desc] of HELP_ENTRIES)
        deps.write(`  ${name.padEnd(10)} ${desc}\n`)
      return true
    }

    if (trimmed === ':status') {
      const uptime = formatUptime(Date.now() - deps.session.startedAt)
      const pid = deps.getBridge().pid
      deps.write(`Session: ${deps.session.id} (uptime ${uptime})\n`)
      deps.write(`Host:    ${deps.targetHost}\n`)
      deps.write(`Bash:    pid ${pid}\n`)

      const auth = deps.getAuth()
      if (!auth) {
        deps.write('User:    (not logged in)\n')
        return true
      }
      deps.write(`User:    ${auth.email}\n`)
      deps.write(`IdP:     ${auth.idp}\n`)
      const expiresMs = auth.expires_at * 1000
      if (expiresMs <= Date.now()) {
        deps.write('Token:   EXPIRED\n')
      }
      else {
        const iso = new Date(expiresMs).toISOString()
        deps.write(`Token:   valid until ${iso}\n`)
      }
      return true
    }

    if (trimmed === ':reset') {
      if (deps.isPending()) {
        deps.write('Cannot reset while a command is running. Wait or press Ctrl-C.\n')
        return true
      }
      await deps.resetBridge()
      const newPid = deps.getBridge().pid
      deps.write(`Bash reset. New pid: ${newPid}\n`)
      return true
    }

    deps.write(`Unknown meta-command \`${trimmed}\`. Try \`:help\`.\n`)
    return true
  }
}
