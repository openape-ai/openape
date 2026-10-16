import { hostname, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { lstat, readlink } from 'node:fs/promises'
import { localDirectory } from '../main/fixture'
import { selectedProfile } from '../main/profile'

export function cliProfile(path?: string): { root: string, base: string } {
  const base = localDirectory(path ? resolve(path) : join(homedir(), 'Library/Application Support/OpenApe Pods'))
  return { base, root: selectedProfile(base) }
}

export async function assertDesktopClosed(root: string): Promise<void> {
  const path = join(root, 'SingletonLock')
  try {
    const info = await lstat(path)
    if (!info.isSymbolicLink()) throw new Error('The desktop profile has an unsupported active lock; close the desktop before using ape-pods')
    const lock = await readlink(path)
    const split = lock.lastIndexOf('-')
    if (split < 0 || lock.slice(0, split) !== hostname() || !/^[1-9]\d*$/.test(lock.slice(split + 1))) throw new Error('The Pods profile belongs to another desktop session')
    try { process.kill(Number(lock.slice(split + 1)), 0) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error }
    throw new Error('Close OpenApe Pods before using ape-pods with this profile; concurrent desktop/CLI access is not supported')
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
