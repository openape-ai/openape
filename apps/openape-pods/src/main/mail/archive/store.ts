import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArchiveRecord } from '../../../contracts/mail-archive'

export class ArchiveStore {
  constructor(private readonly root: string) {}
  async list(podId: string): Promise<ArchiveRecord[]> {
    const directory = this.directory(podId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const names = (await readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
    const records = await Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8')) as ArchiveRecord))
    if (records.some(record => record.manifest.podId !== podId || record.manifest.version !== 1)) throw new Error('Archive storage binding mismatch')
    return records
  }

  async save(record: ArchiveRecord): Promise<void> {
    const directory = this.directory(record.manifest.podId)
    if (!/^[a-f0-9-]{36}$/.test(record.manifest.id)) throw new Error('Invalid archive batch identity')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${record.manifest.id}.json`)
    await writeFile(`${path}.tmp`, JSON.stringify(record), { mode: 0o600, flush: true })
    await rename(`${path}.tmp`, path)
  }

  private directory(podId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(podId)) throw new Error('Invalid archive Pod identity')
    return join(this.root, podId)
  }
}
