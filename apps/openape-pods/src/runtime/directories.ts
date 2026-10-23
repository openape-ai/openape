import { execFile } from 'node:child_process'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import type { DirectoryAccess, DirectoryAssignment, PodResource } from '../contracts/resources'

export interface DirectoryPolicy { readDirectories: string[], writeDirectories: string[] }
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

let helper: string | undefined
/** The native pods-helper reads volume identities; each process that checks assigned folders sets it at startup. */
export function setVolumeIdentityHelper(path: string): void { helper = path }

/**
 * The standard place for data that Pods produce. Being below it grants nothing: each folder is still assigned per Pod,
 * and neither the root nor a folder containing it can be assigned.
 */
export function managedRoot(): string { return join(homedir(), '.openape', 'pods') }

/** st_dev is a mount-instance number that changes on remount; the volume UUID does not. Undefined when the volume has none. */
async function volumeOf(path: string): Promise<string | undefined> {
  if (!helper) return undefined
  let reply: unknown
  try { reply = JSON.parse((await promisify(execFile)(helper, ['volume-identity', path], { timeout: 10_000 })).stdout) }
  catch { throw new Error('The volume identity of this directory is unavailable') }
  const volume = (reply as { volume?: unknown } | null)?.volume
  if (typeof volume !== 'string' || (volume !== '' && !/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(volume))) throw new Error('Invalid volume identity')
  return volume || undefined
}

export async function inspectDirectory(root: string, path: string, access: DirectoryAccess): Promise<DirectoryAssignment> {
  if (!isAbsolute(path) || /[\0\r\n\\"]/.test(path) || !['read', 'readWrite'].includes(access)) throw new Error('Invalid directory permission')
  if (contains(path, managedRoot())) throw new Error('Assign a folder inside the Pods data root, not the root or a folder containing it')
  const canonical = await realpath(path)
  const stat = await lstat(path, { bigint: true })
  if (canonical !== path || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a real directory, not a symbolic link')
  const executable = await realpath(process.execPath)
  const bundle = executable.includes('.app/') ? executable.slice(0, executable.indexOf('.app/') + 4) : dirname(executable)
  for (const protectedPath of [await realpath(root), bundle]) {
    if (contains(path, protectedPath) || contains(protectedPath, path)) throw new Error('This directory overlaps protected application data or runtime files')
  }
  const volume = await volumeOf(path)
  return { path, access, device: String(stat.dev), inode: String(stat.ino), ...(volume ? { volume } : {}) }
}

/**
 * Creates the missing folders of a path below the Pods data root, owner-only. Every existing component must be a real
 * directory owned by this user, so a planted link or foreign folder cannot redirect the assignment. Paths outside the
 * root are left to the ordinary checks.
 */
export async function prepareManagedDirectory(path: string): Promise<void> {
  if (!isAbsolute(path) || normalize(path) !== path || path.endsWith(sep)) throw new Error('Invalid directory path')
  const root = managedRoot()
  const inside = relative(root, path)
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return
  const names = inside.split(sep)
  if (names.some(name => !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name))) throw new Error('Folders below the Pods data root use lowercase names of letters, digits, - and _')
  for (const folder of [dirname(root), root, ...names.map((_, index) => join(root, ...names.slice(0, index + 1)))]) {
    try { await mkdir(folder, { mode: 0o700 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stat = await lstat(folder)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error('The Pods data root must consist of real folders you own')
  }
}

export async function assignedDirectories(root: string, podId: string, resources: PodResource[]): Promise<DirectoryAssignment[]> {
  return Promise.all(resources.filter(resource => resource.podId === podId && resource.kind === 'directory' && resource.state === 'ready').map(async (resource) => {
    const saved = resource.configuration as unknown as DirectoryAssignment
    const current = await inspectDirectory(root, saved.path, saved.access)
    // A record from before volume identities only passes on the mount it was assigned on.
    const sameVolume = saved.volume ? current.volume === saved.volume : current.device === saved.device
    if (!sameVolume || current.inode !== saved.inode) throw new Error('Assigned directory changed; assign the same folder again to refresh it')
    return current
  }))
}
export function directoryPolicy(directories: DirectoryAssignment[]): DirectoryPolicy {
  return { readDirectories: directories.filter(item => item.access === 'read').map(item => item.path), writeDirectories: directories.filter(item => item.access === 'readWrite').map(item => item.path) }
}
