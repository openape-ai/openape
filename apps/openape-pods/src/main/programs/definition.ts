import { basename } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadAdapter } from '@openape/apes'
import type { ProgramDefinition } from '../../contracts/programs'

export async function programDefinition(executablePath: string, adapterFile?: string, commandName?: string): Promise<ProgramDefinition> {
  const executable = await realpath(executablePath)
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  const cliId = commandName ?? basename(executablePath)
  const adapter = loadAdapter(cliId, adapterFile)
  if (!/^[\w-]+$/.test(adapter.adapter.cli.executable)) throw new Error('Application command must use letters, digits, underscores or hyphens')
  const adapterPath = await realpath(adapter.source)
  const entryFiles: ProgramDefinition['entryFiles'] = []
  const environment: Record<string, string> = {}
  return { name: cliId, executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), cliId: adapter.adapter.cli.executable, adapterPath, adapterHash: adapter.digest.replace('SHA-256:', ''), entryFiles, environment, networkHosts: [] }
}
