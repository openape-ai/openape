import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, sep } from 'node:path'
import type { DirectoryAccess, DirectoryAssignment, PodResource } from '../contracts/resources'

export interface DirectoryPolicy { readDirectories: string[], writeDirectories: string[] }
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}
export async function inspectDirectory(root: string, path: string, access: DirectoryAccess): Promise<DirectoryAssignment> {
  if (!isAbsolute(path) || /[\0\r\n\\"]/.test(path) || !['read', 'readWrite'].includes(access)) throw new Error('Invalid directory permission')
  const canonical = await realpath(path)
  const stat = await lstat(path, { bigint: true })
  if (canonical !== path || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Choose a real directory, not a symbolic link')
  const executable = await realpath(process.execPath)
  const bundle = executable.includes('.app/') ? executable.slice(0, executable.indexOf('.app/') + 4) : dirname(executable)
  for (const protectedPath of [await realpath(root), bundle]) {
    if (contains(path, protectedPath) || contains(protectedPath, path)) throw new Error('This directory overlaps protected application data or runtime files')
  }
  return { path, access, device: String(stat.dev), inode: String(stat.ino) }
}
export async function assignedDirectories(root: string, podId: string, resources: PodResource[]): Promise<DirectoryAssignment[]> {
  return Promise.all(resources.filter(resource => resource.podId === podId && resource.kind === 'directory' && resource.state === 'ready').map(async (resource) => {
    const saved = resource.configuration as unknown as DirectoryAssignment
    const current = await inspectDirectory(root, saved.path, saved.access)
    if (current.device !== saved.device || current.inode !== saved.inode) throw new Error('Assigned directory changed; remove it and assign it again')
    return current
  }))
}
export function directoryPolicy(directories: DirectoryAssignment[]): DirectoryPolicy {
  return { readDirectories: directories.filter(item => item.access === 'read').map(item => item.path), writeDirectories: directories.filter(item => item.access === 'readWrite').map(item => item.path) }
}
