import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'

// Stable hardware-rooted host identifier on macOS. We pull
// IOPlatformUUID via `ioreg`, which survives hostname changes,
// disk wipes that preserve hardware (e.g. macOS reinstalls), and
// most other operator-side reshuffles. Replacing the SoC / logic
// board changes it; that's the intended "different host" signal.
//
// Returns a lowercase string with no surrounding whitespace. Empty
// string on failure (we never throw — the caller decides what to do
// when the host can't be identified).
export function getHostId(): string {
  try {
    const output = execFileSync(
      '/usr/sbin/ioreg',
      ['-d2', '-c', 'IOPlatformExpertDevice'],
      { encoding: 'utf8', timeout: 2000 },
    )
    const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
    return match ? match[1]!.trim().toLowerCase() : ''
  }
  catch {
    return ''
  }
}

export function getHostname(): string {
  try { return hostname() }
  catch { return '' }
}
