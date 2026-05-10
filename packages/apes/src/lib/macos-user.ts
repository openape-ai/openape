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
