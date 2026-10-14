import { loadProgramRuntime } from './runtime'
import { basename, sep } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { assertProgramName } from '../../contracts/programs'
import type { ProgramDefinition } from '../../contracts/programs'

export interface InstalledProgramOptions {
  runtimePath?: string
  /** Folders no assigned executable may come from: the Pods profile, Pod folders and assigned writable folders. */
  protectedRoots: string[]
}

/**
 * An installed program, assigned by its path, file hash and optional runtime descriptor (issue 1473, revision 4). Its
 * command name is the file name it was chosen by; the IdP selects what a command means by that name and the file hash.
 * The executable must not come from a folder a Pod can write, and it is verified before every call, so the file the
 * IdP authorized is the file that runs.
 */
export async function installedProgramDefinition(executablePath: string, options: InstalledProgramOptions): Promise<ProgramDefinition> {
  const definition = await programDefinition(executablePath, options.runtimePath)
  await assertOutside(options.protectedRoots, [definition.executable, definition.runtime?.executable, definition.runtime?.descriptor.path, ...definition.entryFiles.map(file => file.path)], definition.runtime?.readDirectories ?? [])
  return definition
}

/**
 * Refuses files inside a protected folder, and read directories that lie inside one or contain one: a Pod could
 * replace what it can write between the assignment and a later run, and a read directory around a protected folder
 * would expose it to the program.
 */
async function assertOutside(roots: string[], files: (string | undefined)[], directories: string[]): Promise<void> {
  const folders = (await Promise.all(roots.map(async (root) => {
    try { return await realpath(root) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }))).filter((folder): folder is string => folder !== null)
  const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}${sep}`)
  const refuse = () => { throw new Error('Assign an installed executable outside the Pods profile, Pod folders and folders Pods can write') }
  for (const path of [...files.filter((file): file is string => !!file), ...directories]) {
    const resolved = await realpath(path)
    if (folders.some(folder => within(resolved, folder))) refuse()
  }
  for (const directory of directories) {
    const resolved = await realpath(directory)
    if (folders.some(folder => within(folder, resolved))) refuse()
  }
}

/** A program by its path; `name` is the command it is called by, the path's file name unless a launcher names it. */
export async function programDefinition(executablePath: string, runtimePath?: string, name = basename(executablePath)): Promise<ProgramDefinition> {
  const executable = await realpath(executablePath)
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  assertProgramName(name)
  return { ...(runtimePath ? { runtime: await loadProgramRuntime(runtimePath) } : {}), name, executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), cliId: name, entryFiles: [], environment: {}, networkHosts: [] }
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
