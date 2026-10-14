import { loadProgramRuntime } from './runtime'
import { basename, join, sep } from 'node:path'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { bindsExecutable, checkCliVersion, fetchRegistry, loadAdapter, loadRegistryAdapter } from '@openape/apes'
import type { RegistryIndex } from '@openape/apes'
import type { ProgramDefinition } from '../../contracts/programs'
import type { VersionProbe } from './version-probe'

export interface RegistryProgramOptions {
  /** Where verified registry adapters are kept by content digest. */
  store: string
  /** Selects the registry entry when the file name differs; it never binds an executable to an adapter by itself. */
  commandName?: string
  runtimePath?: string
  /** Folders no assigned executable may come from: the Pods profile, Pod folders and assigned writable folders. */
  protectedRoots: string[]
  probe: VersionProbe
  registry?: () => Promise<RegistryIndex>
  /** The installed adapters; `apes adapter install` writes ~/.openape/shapes/adapters. */
  adapters?: string
}

/**
 * An executable with the shapes-registry adapter of its CLI, the only adapters Pods assigns (issue 1473). The
 * installed adapter must match the registry index; Pods keeps it as a copy named by its digest, so updating the
 * installed adapter never changes an assignment until the owner replaces it. The executable must be the adapter's
 * executable by its real file name or one of its tested files by digest, and must not come from a folder a Pod can
 * write. A tested digest needs no probe; otherwise the adapter's version command runs once in the isolated sandbox.
 * The executable is hash-pinned and verified before every command, so the version found stays the version that runs.
 */
export async function registryProgramDefinition(executablePath: string, options: RegistryProgramOptions): Promise<ProgramDefinition> {
  const cliId = options.commandName ?? basename(executablePath)
  const { entry, loaded } = loadRegistryAdapter(await (options.registry ?? fetchRegistry)(), cliId, options.adapters)
  const definition = await programDefinition(executablePath, await pinAdapter(options.store, entry.id, loaded.source), cliId, options.runtimePath)
  if (`SHA-256:${definition.adapterHash}` !== entry.digest) throw new Error('The registry adapter changed during assignment; assign the application again')
  await assertOutside(options.protectedRoots, [definition.executable, definition.runtime?.executable, definition.runtime?.descriptor.path, ...definition.entryFiles.map(file => file.path)], definition.runtime?.readDirectories ?? [])
  const digest = `SHA-256:${definition.executableHash}`
  if (!bindsExecutable(loaded.adapter, definition.executable, digest)) throw new Error(`The registry adapter ${entry.id} is for ${loaded.adapter.cli.executable}; ${basename(definition.executable)} is neither that executable nor a file it was tested with`)
  const versionCommand = loaded.adapter.cli.version_command
  const pinned = loaded.adapter.cli.tested_digests?.includes(digest)
  const output = versionCommand && !pinned ? await options.probe(definition, versionCommand) : null
  return { ...definition, registry: { id: entry.id, digest: entry.digest }, cliVersion: checkCliVersion(loaded.adapter, output, digest) }
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

async function pinAdapter(store: string, id: string, source: string): Promise<string> {
  const content = await readFile(source)
  const path = join(store, `${id}-${createHash('sha256').update(content).digest('hex')}.toml`)
  await mkdir(store, { recursive: true, mode: 0o700 })
  try { await writeFile(path, content, { mode: 0o600, flag: 'wx' }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return path
}

/** A definition with a given adapter file: Pods' generated application launchers and portable requirements. */
export async function programDefinition(executablePath: string, adapterFile: string, commandName?: string, runtimePath?: string): Promise<ProgramDefinition> {
  const executable = await realpath(executablePath)
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  const cliId = commandName ?? basename(executablePath)
  const adapter = loadAdapter(cliId, adapterFile)
  if (!/^[\w-]+$/.test(adapter.adapter.cli.executable)) throw new Error('Application command must use letters, digits, underscores or hyphens')
  const adapterPath = await realpath(adapter.source)
  const entryFiles: ProgramDefinition['entryFiles'] = []
  const environment: Record<string, string> = {}
  return { ...(runtimePath ? { runtime: await loadProgramRuntime(runtimePath) } : {}), name: cliId, executable, executableHash: createHash('sha256').update(await readFile(executable)).digest('hex'), cliId: adapter.adapter.cli.executable, adapterPath, adapterHash: adapter.fileDigest.replace('SHA-256:', ''), entryFiles, environment, networkHosts: [] }
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
