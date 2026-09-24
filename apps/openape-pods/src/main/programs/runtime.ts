import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import type { ProgramDefinition, ProgramRuntime } from '../../contracts/programs'
import { verifyExecutable } from '../../worker/runtime/sandbox'

function path(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Runtime paths must be absolute')
  return value
}

export async function loadProgramRuntime(source: string): Promise<ProgramRuntime> {
  const file = await open(path(source), constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytes: Buffer
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 65536 || info.uid !== process.getuid?.() || (info.mode & 0o022)) throw new Error('Choose an owner-controlled runtime file up to 64 KB')
    bytes = await file.readFile()
    if (bytes.length !== info.size) throw new Error('Runtime file changed during assignment')
  }
  finally { await file.close() }
  const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
  if (!value || Array.isArray(value) || value.version !== 1 || Object.keys(value).some(key => !['version', 'executable', 'arguments', 'readDirectories', 'environment'].includes(key))) throw new Error('Invalid program runtime descriptor')
  if (!Array.isArray(value.arguments) || value.arguments.length > 32 || value.arguments.some(arg => typeof arg !== 'string' || arg.length > 8192 || /[\0\r\n]/.test(arg))) throw new Error('Invalid fixed runtime arguments')
  if (!Array.isArray(value.readDirectories) || value.readDirectories.length > 32) throw new Error('Invalid runtime package directories')
  const executable = await realpath(path(value.executable))
  const info = await stat(executable)
  if (!info.isFile() || !(info.mode & 0o111) || info.size > 128 * 1024 * 1024) throw new Error('Choose an executable runtime up to 128 MB')
  const readDirectories = await Promise.all(value.readDirectories.map(async (directory) => {
    const resolved = await realpath(path(directory))
    if (!(await stat(resolved)).isDirectory() || ['/', '/Users', '/Library', '/Applications', '/opt', '/opt/homebrew', homedir()].includes(resolved)) throw new Error('Choose specific runtime package directories, not a system or home root')
    return resolved
  }))
  const environment = value.environment as Record<string, unknown>
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) || Object.keys(environment).length > 16) throw new Error('Invalid runtime environment')
  for (const [key, item] of Object.entries(environment)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || /HOME|PATH|TMP|PROXY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SESSION|_PAT|AUTH|KEY|ELECTRON|DYLD|LD_|NODE_OPTIONS|AZURE_CONFIG_DIR/.test(key) || typeof item !== 'string' || item.length > 4096 || /[\0\r\n]/.test(item)) throw new Error('Runtime environment must contain only non-secret settings; HOME, loader and network settings are managed by Pods')
  }
  const binary = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW)
  let executableHash: string
  try { executableHash = createHash('sha256').update(await binary.readFile()).digest('hex') }
  finally { await binary.close() }
  return { executable, executableHash, arguments: value.arguments as string[], readDirectories, environment: environment as Record<string, string>, descriptor: { path: await realpath(source), hash: createHash('sha256').update(bytes).digest('hex') } }
}

export function programLaunch(assignment: ProgramDefinition) {
  const runtime = assignment.runtime
  return { executable: runtime?.executable ?? assignment.executable, executableHash: runtime?.executableHash ?? assignment.executableHash, prefix: runtime?.arguments ?? [], runtimeDirectories: runtime?.readDirectories ?? [], environment: { ...assignment.environment, ...runtime?.environment } }
}

export async function verifyProgramRuntime(assignment: ProgramDefinition): Promise<void> {
  if (!assignment.runtime) return
  await verifyExecutable(assignment.runtime.executable, assignment.runtime.executableHash)
  await verifyExecutable(assignment.runtime.descriptor.path, assignment.runtime.descriptor.hash)
}
