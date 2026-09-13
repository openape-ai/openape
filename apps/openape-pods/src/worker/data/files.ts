import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'

export interface FileRecord { path: string, size: number, hash: string }
export function relativePath(path: string): string {
  if (!path || path.length > 4096 || path.startsWith('/') || /[\0\r\n\\]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid archive path')
  return path
}
export async function syncDirectory(path: string): Promise<void> {
  const file = await open(path, 'r'); try { await file.sync() }
  finally { await file.close() }
}
export async function files(root: string, subdirectory = '', tolerateRemoval = false): Promise<string[]> {
  const result: string[] = []; const pending = [subdirectory]; let entries = 0
  while (pending.length) {
    const directory = pending.pop()!
    let children
    try { children = await readdir(join(root, directory), { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (tolerateRemoval || directory === subdirectory)) continue; throw error }
    for (const child of children) {
      if (++entries > 100000) throw new Error('Data inventory exceeds 100,000 entries')
      const path = relativePath(directory ? `${directory}/${child.name}` : child.name)
      if (child.isDirectory()) pending.push(path)
      else if (child.isFile()) result.push(path)
      else throw new Error(`Data inventory contains a link or unsupported file: ${path}`)
    }
  }
  return result.sort()
}
export async function copyVerified(sourceRoot: string, path: string, destinationRoot: string, expected?: FileRecord): Promise<FileRecord> {
  relativePath(path)
  const source = join(sourceRoot, path); const destination = join(destinationRoot, path)
  const canonical = await realpath(source)
  if (canonical !== source || !canonical.startsWith(sourceRoot + sep)) throw new Error('Backup source escaped its selected directory')
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await input.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(256 * 1024 * 1024)) throw new Error(`Unsupported or oversized backup file: ${path}`)
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const output = await open(destination, 'wx', 0o600)
    const hash = createHash('sha256'); let size = 0
    try {
      const buffer = Buffer.alloc(1024 * 1024)
      for (;;) {
        const next = await input.read(buffer, 0, buffer.length, null); if (!next.bytesRead) break
        size += next.bytesRead; if (size > 256 * 1024 * 1024) throw new Error('Backup file grew beyond its limit')
        const bytes = buffer.subarray(0, next.bytesRead); hash.update(bytes); await output.writeFile(bytes)
      }
      await output.sync()
    }
    finally { await output.close() }
    const after = await input.stat({ bigint: true }); const record = { path, size, hash: hash.digest('hex') }
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(size) !== before.size) throw new Error(`File changed during backup: ${path}`)
    if (expected && (record.hash !== expected.hash || record.size !== expected.size)) throw new Error(`Backup checksum mismatch: ${path}`)
    return record
  }
  finally { await input.close() }
}
export async function privateTarget(parent: string, name: string): Promise<string> {
  const canonical = await realpath(parent); const info = await lstat(canonical)
  if (!info.isDirectory()) throw new Error('Choose a destination directory')
  relativePath(name)
  const target = join(canonical, name)
  if (relative(canonical, target).includes(sep)) throw new Error('Destination must be a new direct child')
  await mkdir(target, { mode: 0o700 }); return target
}

export async function syncTree(root: string): Promise<void> {
  for (const child of await readdir(root, { withFileTypes: true })) {
    if (child.isDirectory()) await syncTree(join(root, child.name))
  }
  await syncDirectory(root)
}
export async function durableJSON(path: string, value: unknown, mode = 0o600): Promise<void> {
  const file = await open(path, 'wx', mode)
  try { await file.writeFile(JSON.stringify(value)); await file.sync() }
  finally { await file.close() }
}
