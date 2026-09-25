import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { CentralSnapshot } from '../../contracts/central'
import { centralMaxBytes } from '../../contracts/central'

export interface CentralFile { podId: string, path: string, hash: string, size: number, content?: string }
export type ArtifactCache = Map<string, { stamp: string, file: CentralFile }>
export async function managedArtifacts(root: string, snapshot: CentralSnapshot, helper: string, cache: ArtifactCache = new Map()): Promise<CentralFile[]> {
  const result: CentralFile[] = []
  const canonical = await realpath(root)
  const observed = new Set<string>()
  async function add(podId: string, relative: string, publicPath: string, expected?: string) {
    const path = join(canonical, relative)
    if (await realpath(path) !== path || !path.startsWith(canonical + sep)) throw new Error('Managed file escaped the Pod workspace')
    const info = await lstat(path, { bigint: true })
    if (!info.isFile() || info.nlink !== 1n) throw new Error('Managed artifacts must be regular files without links')
    const key = `${podId}:${publicPath}`; observed.add(key)
    const stamp = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
    const cached = cache.get(key)
    if (cached?.stamp === stamp) { result.push(cached.file); return }
    const staging = await mkdtemp(join(canonical, '.central-capture-'))
    try {
      const captured = join(staging, 'content')
      await promisify(execFile)(helper, ['capture-managed', path, captured, String(centralMaxBytes)], { env: { PATH: '/usr/bin:/bin' }, timeout: 10000, maxBuffer: 8192 })
      const bytes = await readFile(captured)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (expected && hash !== expected) throw new Error('Stored artifact hash mismatch')
      const file = { podId, path: publicPath, hash, size: bytes.length, content: bytes.toString('base64') }
      result.push(file); cache.set(key, { stamp, file })
      if (result.length > 100000) throw new Error('Workspace exceeds the managed file limit')
    }
    finally { await rm(staging, { recursive: true, force: true }) }
  }
  let visited = 0

  async function walk(podId: string, relative: string, publicPath: string) {
    if (++visited > 100000 || relative.split('/').length > 64) throw new Error('Workspace directory limit exceeded')
    let info
    try { info = await lstat(join(canonical, relative)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (await realpath(join(canonical, relative)) !== join(canonical, relative)) throw new Error('Managed directory escaped the Pod workspace')
    if (info.isSymbolicLink()) throw new Error('Managed workspaces cannot synchronize symbolic links')
    if (!info.isDirectory()) { await add(podId, relative, publicPath); return }
    for (const name of (await readdir(join(canonical, relative))).sort()) await walk(podId, `${relative}/${name}`, `${publicPath}/${name}`)
  }
  for (const pod of snapshot.pods) {
    const hashes = new Set<string>()
    for (const table of ['scripts', 'sources']) {
      for (const row of snapshot.archive.tables[table] ?? []) {
        if (row.pod_id === pod.id && typeof row.hash === 'string') hashes.add(row.hash)
      }
    }
    for (const hash of [...hashes].sort()) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid stored artifact hash')
      await add(pod.id, `blobs/${hash}`, `blobs/${hash}`, hash)
    }
    await walk(pod.id, `pods/${pod.id}/workspace`, 'workspace')
  }
  for (const key of cache.keys()) {
    if (!observed.has(key)) cache.delete(key)
  }
  return result
}
