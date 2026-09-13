import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Duplex, Readable, Writable } from 'node:stream'

export interface RuntimePolicy {
  executable: string
  workspace: string
  readFiles: string[]
  runtimeDirectories: string[]
  networkPorts?: number[]
}
function literal(path: string): string {
  if (!isAbsolute(path) || /[\0\r\n\\"]/.test(path)) throw new Error('Unsupported sandbox path')
  return JSON.stringify(path)
}
export function sandboxPolicy(policy: RuntimePolicy): string {
  const executable = literal(policy.executable)
  const readFiles = policy.readFiles.map(path => `(literal ${literal(path)})`).join(' ')
  const runtime = policy.runtimeDirectories.map(path => `(subpath ${literal(path)})`).join(' ')
  const network = (policy.networkPorts ?? []).map((port) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid broker port')
    return `(remote ip "127.0.0.1:${port}")`
  }).join(' ')
  return `(version 1)
(deny default)
(allow process-exec (literal ${executable}))
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger"))
(allow file-read-metadata)
(allow file-map-executable (literal ${executable}) (subpath "/System/Library") (subpath "/usr/lib") ${runtime})
(allow file-read* (literal "/") (literal "/dev/null") (literal "/dev/urandom") (literal ${executable}) (subpath "/System/Library") (subpath "/usr/lib") ${readFiles} ${runtime})
(allow file-write* (literal "/dev/null"))
(allow file-read* file-write* (subpath ${literal(policy.workspace)}))
${network ? `(allow network-outbound ${network})` : ''}
`
}
export interface ProcessDomain {
  guardian: ChildProcess
  channel: Duplex
  stdout: Readable
  stderr: Readable
  processId: Promise<number>
  completed: Promise<number>
  cancel: () => void
}
export async function launchSandbox(helper: string, privateDirectory: string, policy: RuntimePolicy, args: string[], environment: Record<string, string> = {}): Promise<ProcessDomain> {
  if (process.platform !== 'darwin') throw new Error('Native pod execution requires macOS')
  const profile = join(privateDirectory, `policy-${randomUUID()}.sb`)
  const canonical = { ...policy, executable: await realpath(policy.executable), workspace: await realpath(policy.workspace) }
  await writeFile(profile, sandboxPolicy(canonical), { flag: 'wx', mode: 0o600 })
  const guardian = spawn(helper, ['supervise', '/usr/bin/sandbox-exec', '-f', profile, canonical.executable, ...args], { cwd: canonical.workspace, env: { HOME: canonical.workspace, TMPDIR: canonical.workspace, PATH: '/usr/bin:/bin', ...environment }, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
  const lease = guardian.stdin as Writable
  const channel = guardian.stdio[3] as Duplex
  const control = guardian.stdio[4] as Readable
  const heartbeat = setInterval(() => { if (!lease.destroyed) lease.write('H') }, 5000)
  lease.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') console.error('Pod lease failed', error.message) })
  let ready = false
  let resolvePid: (pid: number) => void
  let rejectPid: (error: Error) => void
  const processId = new Promise<number>((resolve, reject) => { resolvePid = resolve; rejectPid = reject })
  let buffer = ''
  control.on('data', (bytes: Buffer) => {
    buffer += bytes.toString()
    if (buffer.length > 8192) { lease.end('X'); rejectPid(new Error('Invalid guardian response')); return }
    const newline = buffer.indexOf('\n')
    if (ready || newline < 0) return
    try {
      const value = JSON.parse(buffer.slice(0, newline)) as { pid?: number }
      if (!Number.isSafeInteger(value.pid) || (value.pid ?? 0) < 1) throw new Error('Invalid process identity')
      ready = true; resolvePid(value.pid as number)
    }
    catch (error) { lease.end('X'); rejectPid(error instanceof Error ? error : new Error('Invalid guardian response')) }
  })
  const completed = new Promise<number>((resolve, reject) => {
    guardian.once('error', (error) => { clearInterval(heartbeat); rejectPid(error); reject(error) })
    guardian.once('exit', (code) => {
      clearInterval(heartbeat)
      if (!ready) rejectPid(new Error('Guardian exited before process registration'))
      resolve(code ?? 128)
    })
  })
  return { guardian, channel, stdout: guardian.stdout as Readable, stderr: guardian.stderr as Readable, processId, completed, cancel: () => { if (!lease.destroyed) lease.end('X') } }
}
export async function verifyExecutable(path: string, expectedHash: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Missing executable digest')
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  if (hash !== expectedHash) throw new Error('Executable integrity mismatch')
}
