import { loadProgramRuntime } from './runtime'
import { basename } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadAdapter } from '@openape/apes'
import type { ProgramDefinition } from '../../contracts/programs'

export async function programDefinition(executablePath: string, adapterFile?: string, commandName?: string, runtimePath?: string): Promise<ProgramDefinition> {
  const executable = await realpath(executablePath)
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  const cliId = commandName ?? basename(executablePath)
  const adapter = loadAdapter(cliId, adapterFile)
  if (!/^[\w-]+$/.test(adapter.adapter.cli.executable)) throw new Error('Application command must use letters, digits, underscores or hyphens')
  const adapterPath = await realpath(adapter.source)
  const entryFiles: ProgramDefinition['entryFiles'] = []
  const environment: Record<string, string> = {}
  return { ...(runtimePath ? { runtime: await loadProgramRuntime(runtimePath) } : {}), name: cliId, executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), cliId: adapter.adapter.cli.executable, adapterPath, adapterHash: adapter.digest.replace('SHA-256:', ''), entryFiles, environment, networkHosts: [] }
}

export async function suggestedProgram(name: string, searchPath: string): Promise<string | undefined> {
  if (!/^[\w.-]+$/.test(name)) return undefined
  for (const directory of searchPath.split(':').filter(path => path.startsWith('/'))) {
    const candidate = `${directory}/${name}`
    try { const info = await stat(candidate); if (info.isFile() && (info.mode & 0o111)) return candidate }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error }
  }
  return undefined
}
