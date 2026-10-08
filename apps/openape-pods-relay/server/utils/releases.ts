import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { parsePodsRelease } from '@openape/pods-protocol'
import type { PodsRelease } from '@openape/pods-protocol'

export async function readRelease(directory: string, version?: string): Promise<PodsRelease | null> {
  if (!directory) return null
  if (version && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version')
  const path = version ? join(directory, 'releases', version, 'release.json') : join(directory, 'stable.json')
  let file
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid release metadata file')
    const release = parsePodsRelease(JSON.parse(await file.readFile('utf8')))
    if (version && version !== release.version) throw new Error('Release version mismatch')
    return release
  }
  finally { await file.close() }
}
