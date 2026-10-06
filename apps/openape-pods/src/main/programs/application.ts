import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProgramDefinition } from '../../contracts/programs'
import { programDefinition } from './definition'

export interface ApplicationBundle { bundlePath: string, executable: string, executableHash: string, identity: string | null, version: string | null }
export type ReadApplicationPlist = (path: string) => Promise<string>
async function readApplicationPlist(path: string): Promise<string> {
  const { stdout } = await promisify(execFile)('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { maxBuffer: 1024 * 1024 })
  return stdout
}
export async function applicationBundle(path: string, readPlist: ReadApplicationPlist = readApplicationPlist): Promise<ApplicationBundle> {
  const bundlePath = await realpath(path)
  if (!bundlePath.endsWith('.app') || !(await stat(bundlePath)).isDirectory()) throw new Error('Choose a macOS application bundle')
  const info = JSON.parse(await readPlist(join(bundlePath, 'Contents/Info.plist'))) as { CFBundleExecutable?: string, CFBundleIdentifier?: unknown, CFBundleShortVersionString?: unknown }
  if (typeof info.CFBundleExecutable !== 'string' || !info.CFBundleExecutable || /[/\\\0\r\n]/.test(info.CFBundleExecutable)) throw new Error('Application has no valid bundle executable')
  const executable = await realpath(join(bundlePath, 'Contents/MacOS', info.CFBundleExecutable))
  if (!executable.startsWith(`${bundlePath}/Contents/`)) throw new Error('Application executable must belong to its bundle')
  const executableInfo = await stat(executable)
  if (!executableInfo.isFile() || !(executableInfo.mode & 0o111) || executableInfo.size > 128 * 1024 * 1024) throw new Error('Choose an executable CLI up to 128 MB')
  const executableHash = createHash('sha256').update(await readFile(executable)).digest('hex')
  const identity = typeof info.CFBundleIdentifier === 'string' && /^[a-z0-9][a-z0-9.-]{0,199}$/i.test(info.CFBundleIdentifier) ? info.CFBundleIdentifier.toLowerCase() : null
  const version = typeof info.CFBundleShortVersionString === 'string' && /^[\w.+-]{1,100}$/.test(info.CFBundleShortVersionString) ? info.CFBundleShortVersionString : null
  return { bundlePath, executable, executableHash, identity, version }
}

export async function applicationDefinition(path: string, definitions: string): Promise<ProgramDefinition> {
  return bundleDefinition(await applicationBundle(path), definitions)
}

export async function bundleDefinition({ bundlePath, executable, executableHash }: ApplicationBundle, definitions: string): Promise<ProgramDefinition> {
  if (createHash('sha256').update(await readFile(executable)).digest('hex') !== executableHash) throw new Error('Application changed; select it again in Permissions')
  const cliId = `pod-app-${createHash('sha256').update(bundlePath).digest('hex').slice(0, 16)}`
  await mkdir(definitions, { recursive: true, mode: 0o700 })
  const adapterPath = join(definitions, `${cliId}.toml`)
  await writeFile(adapterPath, launchDescriptor(cliId, basename(bundlePath, '.app')), { mode: 0o600 })
  const definition = await programDefinition(executable, adapterPath, cliId)
  if (definition.executable !== executable || definition.executableHash !== executableHash) throw new Error('Application changed; select it again in Permissions')
  return { ...definition, name: basename(bundlePath, '.app'), bundlePath, cliId }
}

export function launchDescriptor(cliId: string, name = cliId): string {
  if (!/^[\w-]+$/.test(cliId)) throw new Error('Invalid application launcher identity')
  return `schema="openape-shapes/v1"\n[cli]\nid="${cliId}"\nexecutable="${cliId}"\naudience="shapes"\n[[operation]]\nid="open"\ncommand=[]\ndisplay=${JSON.stringify(`Open application ${name}`)}\naction="open"\nrisk="high"\nexact_command=true\nresource_chain=["application:id=${cliId}"]\n`
}

export async function verifyApplicationBundle(definition: ProgramDefinition): Promise<void> {
  try { await stat(definition.executable) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Application is missing. Assign an installed application in Permissions, then review the script commands.')
    throw error
  }
  if (!definition.bundlePath) return
  const executable = await realpath(definition.executable)
  if (!executable.startsWith(`${await realpath(definition.bundlePath)}/Contents/`)) throw new Error('Application bundle changed; select it again in Permissions')
  if (createHash('sha256').update(await readFile(executable)).digest('hex') !== definition.executableHash) throw new Error('Application changed; select it again in Permissions')
}
