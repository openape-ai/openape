import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export interface MacOSUserSummary {
  name: string
  uid: number | null
  shell: string | null
  /** Resolved NFSHomeDirectory — varies between /Users/<name> for
   *  legacy agents and /var/openape/homes/<name> for Phase G+ agents. */
  homeDir: string | null
}

export function isDarwin(): boolean {
  return process.platform === 'darwin'
}

/**
 * Prefix every spawned macOS service user with this string so
 * `cleanup-orphans`, operator tooling, and any future `dscl . -list
 * /Users` audit can identify OpenApe-managed accounts at a glance
 * without scanning the full UID range. Agent-facing surfaces (email,
 * troop UI, bridge data dir, `apes agents list`) keep the bare agent
 * name — the prefix lives only at the macOS layer.
 */
export const MACOS_USER_PREFIX = 'openape-agent-'

export function macOSUsernameForAgent(agentName: string): string {
  return `${MACOS_USER_PREFIX}${agentName}`
}

/**
 * Resolve the macOS user record for an agent, trying the prefixed
 * name first (new spawns) and falling back to the bare agent name
 * (pre-prefix agents). Returns null when neither exists. Used by
 * destroy / run --as / list so legacy agents keep working
 * transparently.
 */
export function lookupMacOSUserForAgent(agentName: string): MacOSUserSummary | null {
  return readMacOSUser(macOSUsernameForAgent(agentName)) ?? readMacOSUser(agentName)
}

export interface OrphanRecord {
  /** dscl record name (e.g. `openape-agent-igor`). */
  name: string
  uid: number | null
  /** The NFSHomeDirectory the record points at — already verified to be missing. */
  homeDir: string
}

/**
 * Enumerate dscl user records that look like OpenApe agent tombstones:
 * either prefixed with `openape-agent-`, or whose home dir is under
 * `/var/openape/homes/` (legacy agents pre-prefix). A record counts as
 * orphaned when its NFSHomeDirectory does not exist on disk anymore —
 * matching the post-destroy state that opendirectoryd refuses to clean
 * up from escapes' setuid-root audit-session.
 *
 * Caller invariant: process is running with admin audit-session
 * (i.e. invoked under interactive `sudo`). The dscl/readFile calls
 * themselves don't strictly need root, but the cleanup pass that
 * consumes this list does.
 */
export function listOrphanedAgentRecords(): OrphanRecord[] {
  if (!isDarwin()) return []
  let output: string
  try {
    output = execFileSync('dscl', ['.', '-list', '/Users', 'NFSHomeDirectory'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  catch { return [] }

  const orphans: OrphanRecord[] = []
  for (const line of output.split('\n')) {
    // dscl emits "<name>\t<homeDir>" — but the separator can collapse
    // to runs of whitespace, so split on /\s+/ and take first + last.
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const name = parts[0]!
    const homeDir = parts.slice(1).join(' ')
    const looksLikeAgent = name.startsWith(MACOS_USER_PREFIX) || homeDir.startsWith('/var/openape/homes/')
    if (!looksLikeAgent) continue
    if (existsSync(homeDir)) continue
    const record = readMacOSUser(name)
    orphans.push({ name, uid: record?.uid ?? null, homeDir })
  }
  return orphans
}

/**
 * Read a single user via `dscl . -read /Users/<name>`.
 * Returns null when the user doesn't exist (dscl exits non-zero with a
 * `eDSRecordNotFound`-style error). Any other error propagates.
 */
export function readMacOSUser(name: string): MacOSUserSummary | null {
  let output: string
  try {
    output = execFileSync('dscl', ['.', '-read', `/Users/${name}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  catch {
    return null
  }

  const uidMatch = output.match(/UniqueID:\s*(\d+)/)
  const shellMatch = output.match(/UserShell:\s*(\S.*)$/m)
  const homeMatch = output.match(/NFSHomeDirectory:\s*(\S.*)$/m)
  return {
    name,
    uid: uidMatch ? Number.parseInt(uidMatch[1]!, 10) : null,
    shell: shellMatch ? shellMatch[1]!.trim() : null,
    homeDir: homeMatch ? homeMatch[1]!.trim() : null,
  }
}

/**
 * List all macOS user names via `dscl . -list /Users`.
 * Returns the raw set of names (no filtering), one per line.
 */
export function listMacOSUserNames(): Set<string> {
  let output: string
  try {
    output = execFileSync('dscl', ['.', '-list', '/Users'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  catch {
    return new Set()
  }
  return new Set(
    output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0),
  )
}

/**
 * Resolve a binary on PATH using `which`. Returns the absolute path or null.
 */
export function whichBinary(name: string): string | null {
  try {
    const out = execFileSync('which', [name], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  }
  catch {
    return null
  }
}

/**
 * Check whether the given shell path is registered in /etc/shells. macOS
 * (and chsh on most Unixes) refuses to set a login shell that isn't listed.
 */
export function isShellRegistered(shellPath: string): boolean {
  if (!existsSync('/etc/shells')) return false
  const content = readFileSync('/etc/shells', 'utf-8')
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .includes(shellPath)
}
