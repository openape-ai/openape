import { execFile } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export interface FileAssignment { id: string, revision: number, path: string }
export interface SnapshotFile extends FileAssignment { hash: string, size: number, device: string, inode: string, mtime: string, capturedAt: string, content: string }
export interface SnapshotSet { id: string, files: SnapshotFile[] }
export async function createSnapshotSet(helper: string, destination: string, assignments: FileAssignment[]): Promise<SnapshotSet> {
  if (!isAbsolute(helper) || !isAbsolute(destination)) throw new Error('Snapshot paths must be absolute')
  if (assignments.length > 100) throw new Error('Too many reference files')
  const id = randomUUID()
  const staging = join(destination, `.stage-${id}`)
  const published = join(destination, id)
  await mkdir(destination, { recursive: true, mode: 0o700 }); await mkdir(staging, { mode: 0o700 })
  const files: SnapshotFile[] = []
  try {
    for (const assignment of assignments) {
      if (!/^[a-f0-9-]{36}$/.test(assignment.id) || !Number.isSafeInteger(assignment.revision) || assignment.revision < 1 || !isAbsolute(assignment.path)) throw new Error('Invalid file assignment')
      const content = join(staging, assignment.id)
      const { stdout } = await execute(helper, ['capture', assignment.path, content, String(20 * 1024 * 1024)], { env: { PATH: '/usr/bin:/bin' }, timeout: 10000, maxBuffer: 8192 })
      const metadata = JSON.parse(stdout) as { size: number, device: string, inode: string, mtime: string }
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > 20 * 1024 * 1024 || ['device', 'inode', 'mtime'].some(key => typeof metadata[key as keyof typeof metadata] !== 'string')) throw new Error('Invalid capture response')
      const hash = createHash('sha256').update(await readFile(content)).digest('hex')
      files.push({ ...assignment, ...metadata, hash, content: join(published, assignment.id), capturedAt: new Date().toISOString() })
    }
    if (files.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) throw new Error('Snapshot set exceeds 100 MiB')
    const manifest = await open(join(staging, 'manifest.json'), 'wx', 0o400)
    try { await manifest.writeFile(JSON.stringify({ id, files })); await manifest.sync() }
    finally { await manifest.close() }
    const directory = await open(staging, 'r')
    try { await directory.sync() }
    finally { await directory.close() }
    await rename(staging, published)
    const parent = await open(destination, 'r')
    try { await parent.sync() }
    finally { await parent.close() }
    return { id, files }
  }
  catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}
