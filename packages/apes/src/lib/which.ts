import { execFileSync } from 'node:child_process'

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
