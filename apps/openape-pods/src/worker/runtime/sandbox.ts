import { quoteShell } from '../../runtime/environment'
import type { SandboxReach } from '../../contracts/sandbox'
import { existsSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
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
`
}
/** The services through which a program registers login items and background tasks. */
const registrationServices = '(global-name "com.apple.xpc.smd") (global-name "com.apple.xpc.loginitemregisterd") (global-name-prefix "com.apple.backgroundtaskmanagement") (global-name "com.apple.coreservices.sharedfilelistd.xpc")'
/**
 * The owner level: everything the owner can do, then the protected paths denied, then the program's own workspace,
 * state and runtime allowed again, then writes to the persistence locations denied (the last matching rule wins, so
 * no assigned folder reopens them). Seatbelt checks a Unix socket connection as network access, not as file access, so
 * the sockets under the protected paths (such as the Pods MCP control socket) are closed separately; the isolated level
 * allows no Unix socket at all. The services that register login items and background tasks stay unreachable. Network
 * reach is the owner's as well, so the application network hosts and their proxy only apply at the isolated level.
 */
function ownerPolicy(policy: RuntimePolicy, executable: string): string {
  const protectedPaths = policy.reach?.protectedPaths ?? []
  const persistence = policy.reach?.persistencePaths ?? []
  if (!protectedPaths.length || !persistence.length) throw new Error('The owner sandbox level needs its protected paths')
  const denied = protectedPaths.map(path => `(subpath ${literal(path)})`).join(' ')
  const sockets = protectedPaths.map(path => `(remote unix-socket (subpath ${literal(path)}))`).join(' ')
  const writes = [policy.workspace, ...(policy.writeDirectories ?? [])].map(path => `(subpath ${literal(path)})`).join(' ')
  const reads = [...(policy.readDirectories ?? []), ...policy.runtimeDirectories].map(path => `(subpath ${literal(path)})`).join(' ')
  const files = [executable, ...policy.readFiles.map(literal)].map(path => `(literal ${path})`).join(' ')
  // The folders on the way to each location stay closed as well, so a location cannot be moved aside and replaced.
  const ancestors = [...new Set(persistence.flatMap(path => path.split('/').slice(1, -1).map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`)))]
  const persistent = [...persistence.map(path => `(subpath ${literal(path)})`), ...ancestors.map(path => `(literal ${literal(path)})`)].join(' ')
  return `(version 1)
(allow default)
(deny file-read* file-write* ${denied})
(allow file-read* file-write* ${writes})
(allow file-read* file-map-executable ${files} ${reads})
(deny file-write* ${persistent})
(deny network-outbound ${sockets})
(deny mach-lookup ${registrationServices})
(deny job-creation)
`
}

const canonical = (path: string) => existsSync(path) ? realpathSync(path) : path
/** A path as written and as resolved: the resolved form closes access through links, the written form closes replacing a link. */
const forms = (path: string) => [...new Set([path, canonical(path)])]

/** What the owner level never reaches: this Pods profile (and the base that holds all profiles), the owner's apes login and the keychains. */
export function ownerProtectedPaths(profileRoot: string, home: string): string[] {
  const base = join(canonical(profileRoot), '..')
  const paths = [profileRoot, ...(existsSync(join(base, 'selected-profile.json')) ? [base] : []), join(home, '.config/apes'), join(home, 'Library/Keychains')]
  return [...new Set(paths.flatMap(forms))]
}

const homePersistence = [
  'Library/LaunchAgents', 'Library/Application Support/com.apple.backgroundtaskmanagementagent', 'Library/Preferences',
  '.zshrc', '.zprofile', '.zshenv', '.zlogin', '.zlogout', '.bashrc', '.bash_profile', '.bash_login', '.profile', '.config/fish', '.zsh_shared',
  '.ssh', '.gitconfig', '.config/git', '.npmrc', '.local/bin', 'Library/pnpm', 'Library/Pnpm', '.codex', '.claude', '.claude.json',
  'Applications/OpenApe Pods.app', 'Library/Application Support/OpenApe Pods Rollback',
]
const systemPersistence = ['/Library/LaunchAgents', '/Library/LaunchDaemons', '/Library/StartupItems', '/private/var/at', '/Applications/OpenApe Pods.app', '/opt/homebrew', '/usr/local']

/** Where the owner moved the Codex and Claude Code configuration away from their home defaults. */
export interface AgentConfiguration { CODEX_HOME?: string, CLAUDE_CONFIG_DIR?: string }

/**
 * Where an owner-level program could leave code that starts after its run: launch agents and daemons, login items,
 * cron and at jobs, shell startup files, SSH, Git and npm configuration, program folders on the owner's PATH (Homebrew,
 * /usr/local, ~/.local/bin, pnpm), the Codex and Claude Code configuration with their hooks and MCP servers,
 * preferences, the installed Pods app and its rollback copy. Each location is listed as written and as resolved.
 */
export function ownerPersistencePaths(home: string, configuration: AgentConfiguration = {}): string[] {
  const configured = [configuration.CODEX_HOME, configuration.CLAUDE_CONFIG_DIR].filter((path): path is string => !!path).map(path => resolve(path))
  const paths = [...forms(home).flatMap(base => homePersistence.map(path => join(base, path))), ...configured, ...systemPersistence]
  return [...new Set(paths.flatMap(forms))]
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
  await register?.(recordPath, process.pid)
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
export async function verifyExecutable(path: string, expectedHash: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Missing executable digest')
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  if (hash !== expectedHash) throw new Error('Executable integrity mismatch')
}
