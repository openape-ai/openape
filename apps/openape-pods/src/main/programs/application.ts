import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProgramDefinition } from '../../contracts/programs'
import { programDefinition } from './definition'

export async function applicationDefinition(path: string, definitions: string): Promise<ProgramDefinition> {
  const bundlePath = await realpath(path)
  if (!bundlePath.endsWith('.app') || !(await stat(bundlePath)).isDirectory()) throw new Error('Choose a macOS application bundle')
  const { stdout } = await promisify(execFile)('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundlePath, 'Contents/Info.plist')], { maxBuffer: 1024 * 1024 })
  const info = JSON.parse(stdout) as { CFBundleExecutable?: string }
  if (typeof info.CFBundleExecutable !== 'string' || !info.CFBundleExecutable || /[/\\\0\r\n]/.test(info.CFBundleExecutable)) throw new Error('Application has no valid bundle executable')
  const executable = await realpath(join(bundlePath, 'Contents/MacOS', info.CFBundleExecutable))
  if (!executable.startsWith(`${bundlePath}/Contents/`)) throw new Error('Application executable must belong to its bundle')
  const cliId = `pod-app-${createHash('sha256').update(bundlePath).digest('hex').slice(0, 16)}`
  await mkdir(definitions, { recursive: true, mode: 0o700 })
  const adapterPath = join(definitions, `${cliId}.toml`)
  await writeFile(adapterPath, launchDescriptor(cliId, basename(bundlePath, '.app')), { mode: 0o600 })
  const definition = await programDefinition(executable, adapterPath, cliId)
  return { ...definition, name: basename(bundlePath, '.app'), bundlePath, cliId }
}

export function launchDescriptor(cliId: string, name = cliId): string {
  if (!/^[\w-]+$/.test(cliId)) throw new Error('Invalid application launcher identity')
  return `schema="openape-shapes/v1"\n[cli]\nid="${cliId}"\nexecutable="${cliId}"\naudience="shapes"\n[[operation]]\nid="open"\ncommand=[]\ndisplay=${JSON.stringify(`Open application ${name}`)}\naction="open"\nrisk="high"\nexact_command=true\nresource_chain=["application:id=${cliId}"]\n`
}

export async function verifyApplicationBundle(definition: ProgramDefinition): Promise<void> {
  try { await stat(definition.executable) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Application is missing. Select its installed replacement in Permissions, then review the script commands.')
    throw error
  }
  if (!definition.bundlePath) return
  const executable = await realpath(definition.executable)
  if (!executable.startsWith(`${await realpath(definition.bundlePath)}/Contents/`)) throw new Error('Application bundle changed; select it again in Permissions')
  if (createHash('sha256').update(await readFile(executable)).digest('hex') !== definition.executableHash) throw new Error('Application changed; select it again in Permissions')
}
