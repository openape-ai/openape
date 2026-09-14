import { basename, join } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadAdapter } from '@openape/apes'
import type { ProgramDefinition } from '../../contracts/programs'

export async function programDefinition(executablePath: string, adapterFile: string, vendor?: string): Promise<ProgramDefinition> {
  const executable = await realpath(executablePath); const adapterPath = await realpath(adapterFile)
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  const cliId = basename(executable)
  const adapter = loadAdapter(cliId, adapterPath)
  const entryFiles: ProgramDefinition['entryFiles'] = []
  const environment: Record<string, string> = {}
  if (vendor) {
    const roots = join(vendor, 'mail-roots.pem')
    entryFiles.push({ path: roots, hash: createHash('sha256').update(await readFile(roots)).digest('hex') })
    environment.PODS_CA_FILE = roots
  }
  return { name: cliId, executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), cliId: adapter.adapter.cli.id, adapterPath, adapterHash: adapter.digest.replace('SHA-256:', ''), entryFiles, environment, networkHosts: vendor ? ['graph.microsoft.com', 'login.microsoftonline.com'] : [], ...(vendor ? { cacheArgument: '--cache-dir' } : {}) }
}
