import { lstat, readdir, readFile, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { PodDatabase } from '../storage/database'

const validId = (value: string) => /^[a-f0-9-]{36}$/.test(value)

async function removeEmptySet(root: string, podId: string, id: string): Promise<boolean> {
  const pod = join(root, 'snapshots', podId)
  const path = join(pod, id)
  try {
    if (!(await lstat(join(root, 'snapshots'))).isDirectory() || !(await lstat(pod)).isDirectory() || !(await lstat(path)).isDirectory()) return false
    const names = await readdir(path)
    if (names.length === 1 && names[0] === 'manifest.json') {
      const manifestPath = join(path, 'manifest.json')
      if (!(await lstat(manifestPath)).isFile()) return false
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { id?: unknown, files?: unknown }
      if (manifest.id !== id || !Array.isArray(manifest.files) || manifest.files.length) return false
      await unlink(manifestPath)
    }
    else if (names.length) {
      return false
    }
    await rmdir(path)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

export async function cleanEmptySnapshots(store: PodDatabase): Promise<number> {
  const rows = store.db.prepare('SELECT id,pod_id FROM snapshot_sets WHERE json_type(manifest,\'$.files\')=\'array\' AND json_array_length(manifest,\'$.files\')=0 AND json_extract(manifest,\'$.id\')=id').all()
  let removed = 0
  for (let offset = 0; offset < rows.length; offset += 32) {
    const batch = rows.slice(offset, offset + 32)
    const results = await Promise.allSettled(batch.map(async (row) => {
      const id = String(row.id); const podId = String(row.pod_id)
      if (!validId(id) || !validId(podId)) throw new Error('Invalid empty snapshot identity')
      return await removeEmptySet(store.root, podId, id) ? id : null
    }))
    store.transaction(() => {
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          removed += Number(store.db.prepare('DELETE FROM snapshot_sets WHERE id=? AND json_type(manifest,\'$.files\')=\'array\' AND json_array_length(manifest,\'$.files\')=0').run(result.value).changes)
        }
      }
    })
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  return removed
}
