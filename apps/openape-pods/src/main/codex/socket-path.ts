import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// macOS sun_path holds 104 bytes including the terminating NUL.
const socketPathLimit = 103

/**
 * The Codex control socket: inside the profile when its path fits a Unix socket address, otherwise in a short
 * per-user directory derived from the profile. The launcher hands this path to the MCP shim, so both use the same one.
 */
export function controlSocketPath(profileBase: string, uid: number = process.getuid!()): string {
  const preferred = join(profileBase, 'codex', 'control.sock')
  if (Buffer.byteLength(preferred) <= socketPathLimit) return preferred
  const profile = createHash('sha256').update(profileBase).digest('hex').slice(0, 16)
  return join('/private/tmp', `openape-pods-${uid}-${profile}`, 'control.sock')
}

/** Creates the socket directory private to this user, and refuses one that another user or a link could control. */
export async function privateSocketDirectory(path: string, uid: number = process.getuid!()): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.uid !== uid) throw new Error('The Codex socket directory is not a private directory of this user')
  await chmod(path, 0o700)
}

/** The fallback socket directory outside the profile, as written and as /tmp resolves; owner-level Pods must not reach it either. */
export function controlSocketProtection(profileBase: string, uid: number = process.getuid!()): string[] {
  const directory = dirname(controlSocketPath(profileBase, uid))
  return directory.startsWith('/private/tmp/') ? [directory, directory.replace(/^\/private/, '')] : []
}
