import { loadProgramRuntime, programLaunch } from './runtime'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { checkCliVersion, fetchRegistry, loadAdapter, loadRegistryAdapter } from '@openape/apes'
import type { RegistryIndex } from '@openape/apes'
import type { ProgramDefinition } from '../../contracts/programs'

/** Runs an executable with the adapter's version arguments; null when it exits unsuccessfully or times out. */
export type VersionProbe = (definition: ProgramDefinition, command: string[]) => Promise<string | null>
export interface RegistryProgramOptions {
  /** Where verified registry adapters are kept by content digest. */
  store: string
  commandName?: string
  runtimePath?: string
  registry?: () => Promise<RegistryIndex>
  /** The installed adapters; `apes adapter install` writes ~/.openape/shapes/adapters. */
  adapters?: string
  probe?: VersionProbe
}

/**
 * An executable with the shapes-registry adapter of its CLI, the only adapters Pods assigns (issue 1473). The
 * installed adapter must match the registry index; Pods keeps it as a copy named by its digest, so updating the
 * installed adapter never changes an assignment until the owner replaces it. The adapter's version command runs once
 * here, with the program's launch but without shell or owner environment: the executable is hash-pinned and verified
 * before every command, so the version it printed stays the version that runs.
 */
export async function registryProgramDefinition(executablePath: string, options: RegistryProgramOptions): Promise<ProgramDefinition> {
  const cliId = options.commandName ?? basename(executablePath)
  const { entry, loaded } = loadRegistryAdapter(await (options.registry ?? fetchRegistry)(), cliId, options.adapters)
  const definition = await programDefinition(executablePath, await pinAdapter(options.store, entry.id, loaded.source), cliId, options.runtimePath)
  if (`SHA-256:${definition.adapterHash}` !== entry.digest) throw new Error('The registry adapter changed during assignment; assign the application again')
  const versionCommand = loaded.adapter.cli.version_command
  const output = versionCommand ? await (options.probe ?? probeVersion)(definition, versionCommand) : null
  return { ...definition, registry: { id: entry.id, digest: entry.digest }, cliVersion: checkCliVersion(loaded.adapter, output) }
}

async function pinAdapter(store: string, id: string, source: string): Promise<string> {
  const content = await readFile(source)
  const path = join(store, `${id}-${createHash('sha256').update(content).digest('hex')}.toml`)
  await mkdir(store, { recursive: true, mode: 0o700 })
  try { await writeFile(path, content, { mode: 0o600, flag: 'wx' }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return path
}

async function probeVersion(definition: ProgramDefinition, command: string[]): Promise<string | null> {
  const launch = programLaunch(definition)
  try {
    const { stdout, stderr } = await promisify(execFile)(launch.executable, [...launch.prefix, ...command], { cwd: tmpdir(), env: { ...launch.environment, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' }, timeout: 10000, maxBuffer: 64 * 1024 })
    return `${stdout}\n${stderr}`
  }
  catch (error) {
    // A non-zero exit, signal, timeout or oversized output leaves the version unknown: exact approvals apply.
    const failure = error as { code?: unknown, killed?: boolean, signal?: unknown }
    if (typeof failure.code === 'number' || failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || failure.killed || failure.signal) return null
    throw error
  }
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
