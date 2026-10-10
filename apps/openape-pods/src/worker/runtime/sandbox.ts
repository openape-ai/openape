import { quoteShell } from '../../runtime/environment'
import type { SandboxReach } from '../../contracts/sandbox'
import { existsSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Duplex, Readable, Writable } from 'node:stream'

export interface RuntimePolicy {
  /** `owner` keeps supervision but gives the program the owner's file and network reach except its protected paths; the Pod identity is unchanged. */
  reach?: SandboxReach
  executable: string
  workspace: string
  readFiles: string[]
  runtimeDirectories: string[]
  readDirectories?: string[]
  writeDirectories?: string[]
  networkPorts?: number[]
  systemTrust?: boolean
}
function literal(path: string): string {
  if (!isAbsolute(path) || /[\0\r\n\\"]/.test(path)) throw new Error('Unsupported sandbox path')
  return JSON.stringify(path)
}
function subpaths(paths: string[]): string {
  return paths.map(path => `(subpath ${literal(path)})`).join(' ')
}
/**
 * The folders leading to closed paths stay unwritable, so a closed path cannot be moved aside or replaced through a
 * renamed or linked parent, even inside a writable folder. Each path arrives as written and as resolved.
 */
function ancestorRule(paths: string[]): string {
  const ancestors = [...new Set(paths.flatMap(path => path.split('/').slice(1, -1).map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`)))]
  return ancestors.length ? `(deny file-write* ${ancestors.map(path => `(literal ${literal(path)})`).join(' ')})` : ''
}
export function sandboxPolicy(policy: RuntimePolicy): string {
  const executable = literal(policy.executable)
  if (policy.reach?.level === 'owner') return ownerPolicy(policy, executable)
  const readFiles = policy.readFiles.map(path => `(literal ${literal(path)})`).join(' ')
  const runtime = policy.runtimeDirectories.map(path => `(subpath ${literal(path)})`).join(' ')
  const reads = (policy.readDirectories ?? []).map(path => `(subpath ${literal(path)})`).join(' ')
  const writes = (policy.writeDirectories ?? []).map(path => `(subpath ${literal(path)})`).join(' ')
  const network = (policy.networkPorts ?? []).map((port) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid broker port')
    return `(remote tcp "localhost:${port}")`
  }).join(' ')
  const deny = policy.reach?.deny ?? []
  return `(version 1)
(deny default)
(allow process-exec (literal ${executable}))
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger")${policy.systemTrust ? ' (global-name "com.apple.trustd.agent")' : ''})
(allow file-read-metadata)
(allow file-map-executable (literal ${executable}) (subpath "/System/Library") (subpath "/usr/lib") ${runtime})
(allow file-read* (literal "/") (literal "/dev/null") (literal "/dev/urandom") (literal ${executable}) (subpath "/System/Library") (subpath "/usr/lib") ${readFiles} ${reads} ${runtime})
(allow file-write* (literal "/dev/null"))
(allow file-read* file-write* (subpath ${literal(policy.workspace)}) ${writes})
${network ? `(allow network-outbound ${network})` : ''}
${deny.length ? `${ancestorRule(deny)}\n(deny file-read* file-write* ${subpaths(deny)})` : ''}
`
}
/**
 * The owner level is the owner's reach on this Mac: everything the owner can do, then the protected paths denied, then
 * the program's own workspace, state and runtime allowed again, then the configured denylist denied (the last matching
 * rule wins, so no assigned folder reopens a denied path). The folders leading to a protected or denied path stay
 * unwritable, so it cannot be moved aside and replaced. Seatbelt checks a Unix socket connection as network access,
 * not as file access, so the sockets under these paths (such as the Pods MCP control socket) are closed separately;
 * the isolated level allows no Unix socket at all. Network reach is the owner's as well, so the application network
 * hosts and their proxy only apply at the isolated level.
 *
 * These rules only prevent direct access. A program at this level can leave code that later runs unsandboxed as the
 * owner (launch agents, shell startup files, agent hooks) and act as the owner from there, so the owner level means
 * full trust in the Pod's code; the owner accepted this (issue 1455, October 10, 2026).
 */
function ownerPolicy(policy: RuntimePolicy, executable: string): string {
  const protectedPaths = policy.reach?.protectedPaths ?? []
  const deny = policy.reach?.deny ?? []
  if (!protectedPaths.length) throw new Error('The owner sandbox level needs its protected paths')
  const closed = [...protectedPaths, ...deny]
  const writes = subpaths([policy.workspace, ...(policy.writeDirectories ?? [])])
  const reads = subpaths([...(policy.readDirectories ?? []), ...policy.runtimeDirectories])
  const files = [executable, ...policy.readFiles.map(literal)].map(path => `(literal ${path})`).join(' ')
  return `(version 1)
(allow default)
(deny file-read* file-write* ${subpaths(protectedPaths)})
(allow file-read* file-write* ${writes})
(allow file-read* file-map-executable ${files} ${reads})
${ancestorRule(closed)}
(deny network-outbound ${closed.map(path => `(remote unix-socket (subpath ${literal(path)}))`).join(' ')})
${deny.length ? `(deny file-read* file-write* ${subpaths(deny)})` : ''}
`
}

// The native form returns the letter case on disk; the sandbox compares paths case-sensitively on a case-insensitive volume.
const canonical = (path: string) => existsSync(path) ? realpathSync.native(path) : path
/** A path as written and as resolved: the resolved form closes access through links, the written form closes replacing a link. */
const forms = (path: string) => [...new Set([path, canonical(path)])]

/**
 * What the owner level never reaches, because the Pod identity must never become the owner's: the Pods base folder
 * that holds every profile, the profile selection and the MCP control socket, this Pods profile and the owner's apes login.
 */
export function ownerProtectedPaths(profileRoot: string, profileBase: string, home: string): string[] {
  const paths = [profileBase, profileRoot, join(home, '.config/apes')]
  return [...new Set(paths.flatMap(forms))]
}

/** The configured denylist as absolute paths: `~/` is the owner's home, and each path is listed as written and as resolved. */
export function deniedPaths(entries: string[], home: string): string[] {
  return [...new Set(entries.map(entry => entry.startsWith('~/') ? join(home, entry.slice(2)) : entry).flatMap(forms))]
}

export interface ProcessDomain {
  recordPath: string
  guardian: ChildProcess
  channel: Duplex
  stdout: Readable
  stderr: Readable
  processId: Promise<number>
  completed: Promise<number>
  cancel: () => void
}
export interface ShellLaunch { cli: string, environment: Record<string, string> }
export async function launchSandbox(helper: string, privateDirectory: string, policy: RuntimePolicy, args: string[], environment: Record<string, string> = {}, register?: (path: string, ownerPid: number) => void | Promise<void>, shell?: ShellLaunch): Promise<ProcessDomain> {
  if (process.platform !== 'darwin') throw new Error('Native pod execution requires macOS')
  const profile = join(privateDirectory, `policy-${randomUUID()}.sb`)
  const canonical = { ...policy, executable: await realpath(policy.executable), workspace: await realpath(policy.workspace) }
  await writeFile(profile, sandboxPolicy(canonical), { flag: 'wx', mode: 0o600 })
  if (shell) {
    const command = ['exec', '/usr/bin/env', '-i', ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), '/usr/bin/sandbox-exec', '-f', profile, canonical.executable, ...args]
    return superviseProcess(helper, canonical.executable, [shell.cli, '-c', command.map(quoteShell).join(' ')], canonical.workspace, { ...shell.environment, ELECTRON_RUN_AS_NODE: '1', APES_SHELL_MODE: '1', APES_SHELL_CHANNEL_FD: '3', APE_WAIT: '1' }, privateDirectory, register)
  }
  return superviseProcess(helper, '/usr/bin/sandbox-exec', ['-f', profile, canonical.executable, ...args], canonical.workspace, environment, privateDirectory, register)
}
export async function superviseProcess(helper: string, executable: string, args: string[], workspace: string, environment: Record<string, string>, privateDirectory: string, register?: (path: string, ownerPid: number) => void | Promise<void>, terminal = false): Promise<ProcessDomain> {
  literal(executable); literal(workspace)
  const recordPath = join(privateDirectory, `domain-${randomUUID()}.record`)
  try { await register?.(recordPath, process.pid) }
  catch (error) {
    await sealDomain(helper, recordPath, executable, workspace)
    throw error
  }
  const guardian = spawn(helper, [terminal ? 'supervise-terminal-record' : 'supervise-record', recordPath, executable, ...args], { cwd: workspace, env: { HOME: workspace, TMPDIR: workspace, PATH: '/usr/bin:/bin', ...environment }, stdio: terminal ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
  const lease = guardian.stdin as Writable
  const channel = guardian.stdio[3] as Duplex
  const control = guardian.stdio[4] as Readable
  const heartbeat = setInterval(() => { if (!lease.destroyed && !lease.writableEnded) lease.write('H') }, 5000)
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
    guardian.once('close', (code) => {
      clearInterval(heartbeat)
      if (!ready) rejectPid(new Error('Guardian exited before process registration'))
      resolve(code ?? 128)
    })
  })
  return { recordPath, guardian, channel, stdout: guardian.stdout as Readable, stderr: guardian.stderr as Readable, processId, completed, cancel: () => { if (!lease.destroyed && !lease.writableEnded) lease.end('X') } }
}
// A registration callback can fail after the worker stored the domain, for example when the run is
// aborted meanwhile. Recovery waits for every stored domain to report quiescence, so the guardian
// still writes the record: with a closed lease it records the domain as closed before fork and exits.
async function sealDomain(helper: string, recordPath: string, executable: string, workspace: string): Promise<void> {
  const guardian = spawn(helper, ['supervise-record', recordPath, executable], { cwd: workspace, env: { PATH: '/usr/bin:/bin' }, stdio: 'ignore' })
  const code = await new Promise<number | Error>((resolve) => { guardian.once('error', resolve); guardian.once('close', code => resolve(code ?? 128)) })
  if (code !== 125) console.error('Pod execution domain could not be sealed', code instanceof Error ? code.message : `exit ${code}`)
}
export async function verifyExecutable(path: string, expectedHash: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Missing executable digest')
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  if (hash !== expectedHash) throw new Error('Executable integrity mismatch')
}
