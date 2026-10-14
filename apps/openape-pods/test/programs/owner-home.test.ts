// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { podIdentityFile } from '../../src/main/connections/identity-file'
import type { AgentConnection } from '../../src/main/broker/authorization'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PodToolBroker } from '../../src/main/broker/tools'
import type { ToolAssignment } from '../../src/main/broker/tools'
import { CredentialCache } from '../../src/main/connections/cache'
import { ProgramState } from '../../src/main/programs/state'
import { ProgramSession } from '../../src/main/programs/session'
import type { ProgramAssignment } from '../../src/contracts/programs'
import type { SandboxLevel } from '../../src/contracts/sandbox'
import { launchSandbox } from '../../src/worker/runtime/sandbox'
import type { RuntimePolicy } from '../../src/worker/runtime/sandbox'
import { launchTerminal } from '../../src/worker/runtime/terminal'

// Owner decision October 13, 2026 (issue 1468): at the owner level programs and the application terminal run with the
// owner's HOME, so host logins (az, gh) apply; the isolated level keeps the Pod's private application state as HOME.
vi.mock('../../src/worker/runtime/sandbox', async original => ({ ...await original<typeof import('../../src/worker/runtime/sandbox')>(), launchSandbox: vi.fn() }))
vi.mock('../../src/worker/runtime/terminal', () => ({ launchTerminal: vi.fn() }))
vi.mock('../../src/worker/recovery/domains', () => ({ inspectDomainRecords: vi.fn(async () => {}) }))
vi.mock('../../src/main/broker/authorization', () => ({ AgentAuthority: class { async authorizeProgram() { return { grantId: 'fixture', actions: ['list'], programs: ['az'] } } async assertActive() {} } }))

interface Launch { policy: RuntimePolicy, environment: Record<string, string>, temporaryExisted: boolean }
const podId = randomUUID(); const applicationId = randomUUID()
let root = ''; let credentials: CredentialCache; let launches: Launch[] = []
const protectedPaths = ['/fixture/OpenApe Pods', '/fixture/.config/apes']
const reach = (level: SandboxLevel) => ({ level, protectedPaths })

function domain() {
  return { stdout: new PassThrough(), stderr: new PassThrough(), channel: new PassThrough(), recordPath: '/fixture/domain.record', processId: Promise.resolve(4242), completed: Promise.resolve(0), cancel: () => {} }
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-owner-home-'))); launches = []
  credentials = new CredentialCache(join(root, 'credentials'), { available: () => true, encrypt: value => Buffer.from(value), decrypt: bytes => bytes.toString() })
  const record = (policy: RuntimePolicy, environment: Record<string, string>) => { launches.push({ policy, environment, temporaryExisted: existsSync(environment.TMPDIR!) }); return domain() }
  vi.mocked(launchSandbox).mockImplementation(async (_helper, _directory, policy, _args, environment = {}) => record(policy, environment) as never)
  vi.mocked(launchTerminal).mockImplementation(async (_helper, _directory, policy, _args, environment) => record(policy, environment) as never)
})
afterEach(async () => { vi.clearAllMocks(); await rm(root, { recursive: true, force: true }) })

async function executable(): Promise<{ path: string, hash: string }> {
  const path = join(root, 'az'); await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  return { path, hash: createHash('sha256').update(await readFile(path)).digest('hex') }
}
/** The private application state folder: opened from the encrypted record below the credential store for one session. */
const applicationState = expect.stringMatching(/\/credentials\/temporary\/.+\/application$/)

async function brokerCall(level: SandboxLevel, identityConnection?: AgentConnection) {
  const program = await executable(); const stateId = await new ProgramState(credentials).create({ podId, applicationId })
  const argv = ['repos', 'pr', 'list']
  const assignment: ToolAssignment = { id: applicationId, identityConnection, program: { path: program.path, name: 'az', sha256: program.hash }, argv, reach: reach(level), programState: { id: stateId, podId, applicationId }, capability: 'tool.az.invoke', executable: program.path, executableHash: program.hash, entryFiles: [], prefix: [], runtimeDirectories: [], environment: {}, runtimeEnvironment: { HOME: '/descriptor/home' }, networkPorts: [] }
  const broker = new PodToolBroker('/fixture/helper', join(root, 'broker'), async () => {}, credentials)
  const reply = await broker.execute(assignment, { toolId: applicationId, argv }, { capabilities: ['tool.az.invoke'], assertCurrent: () => {}, signal: AbortSignal.timeout(5000) })
  return { reply, launch: launches.at(-1)! }
}

it('runs an owner-level program with the owner HOME and a temporary folder outside its saved application state', async () => {
  const { reply, launch } = await brokerCall('owner')
  expect(reply).toEqual({ exitCode: 0, stdout: '', stderr: '' })
  // A runtime descriptor cannot redirect HOME; the owner's home is the one the protected paths are computed for.
  expect(launch.environment.HOME).toBe(homedir())
  expect(launch.environment.TMPDIR).not.toContain('/application')
  expect(launch.environment.TMPDIR!.startsWith(join(root, 'broker', 'tmp-'))).toBe(true)
  expect(launch.temporaryExisted).toBe(true)
  expect(launch.policy.writeDirectories).toContain(launch.environment.TMPDIR)
  expect(launch.policy.reach).toEqual(reach('owner'))
  // The temporary folder is removed after the call, so it never fills the application state or the profile.
  expect(existsSync(launch.environment.TMPDIR!)).toBe(false)
})

it('keeps an isolated program in its private application state for HOME and temporary files', async () => {
  const { launch } = await brokerCall('isolated')
  expect(launch.environment.HOME).toEqual(applicationState)
  expect(launch.environment.TMPDIR).toBe(launch.environment.HOME)
  expect(launch.policy.workspace).toBe(launch.environment.HOME)
  expect(launch.policy.writeDirectories).toEqual([])
})

async function terminal(level: SandboxLevel) {
  const program = await executable(); const stateId = await new ProgramState(credentials).create({ podId, applicationId })
  const assignment = { type: 'program', name: 'az', cliId: 'az', executable: program.path, executableHash: program.hash, stateId, capability: 'tool.az.invoke', networkHosts: [], entryFiles: [], environment: {} } as unknown as ProgramAssignment
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const sessionId = randomUUID()
  const session = new ProgramSession(sessionId, podId, applicationId, assignment, ['login'], '/fixture/helper', join(root, 'authentication'), credentials, async () => {}, async () => {}, workspace, { readDirectories: [], writeDirectories: [] }, { connection: async () => ({}) as never, ledger: {} as never, origin: async () => 'Pod', reach: async () => reach(level) })
  await session.completed
  expect(session.view().error).toBeNull()
  return { launch: launches.at(-1)!, sessionDirectory: join(root, 'authentication', sessionId) }
}

it('opens the owner-level application terminal with the owner HOME, so a login there is the owner\'s host login', async () => {
  const { launch, sessionDirectory } = await terminal('owner')
  expect(launch.environment.HOME).toBe(homedir())
  expect(launch.environment.TMPDIR).toBe(join(sessionDirectory, 'tmp'))
  expect(launch.temporaryExisted).toBe(true)
  expect(launch.policy.writeDirectories).toEqual([applicationState, join(sessionDirectory, 'tmp')])
  expect(existsSync(join(sessionDirectory, 'tmp'))).toBe(false)
})

it('keeps the isolated application terminal in the private application state', async () => {
  const { launch } = await terminal('isolated')
  expect(launch.environment.HOME).toEqual(applicationState)
  expect(launch.environment.TMPDIR).toBe(launch.environment.HOME)
  expect(launch.policy.writeDirectories).toEqual([launch.environment.HOME])
})

const connection = (accessToken = async () => 'SYNTHETIC_POD_TOKEN'): AgentConnection => ({ issuer: 'https://id.example.test', subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'key', targetHost: 'pods:fixture', accessToken })

it.each(['owner', 'isolated'] as const)('passes only the Pod identity file to a %s program, redacts its token, and removes the file', async (level) => {
  let path = ''
  vi.mocked(launchSandbox).mockImplementation(async (_helper, _directory, policy, _args, environment = {}) => {
    path = environment.APES_AUTH_FILE!
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ email: 'pod@example.test', access_token: 'SYNTHETIC_POD_TOKEN' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(policy.readFiles).toContain(path)
    expect(policy.writeDirectories).not.toContain(path)
    const process = domain()
    process.completed = new Promise(resolve => setImmediate(() => { process.stdout.write('SYNTHETIC_POD_TOKEN'); process.stderr.write('SYNTHETIC_POD_TOKEN'); resolve(0) }))
    return process as never
  })
  const { reply } = await brokerCall(level, connection())
  expect(reply).toMatchObject({ stdout: '[REDACTED]', stderr: '[REDACTED]' })
  expect(existsSync(path)).toBe(false)
})

it('removes the Pod identity when the native program cannot start', async () => {
  let path = ''
  vi.mocked(launchSandbox).mockImplementation(async (_helper, _directory, _policy, _args, environment = {}) => {
    path = environment.APES_AUTH_FILE!
    throw new Error('Synthetic launch failure')
  })
  await expect(brokerCall('owner', connection())).rejects.toThrow('Synthetic launch failure')
  expect(path).not.toBe('')
  expect(existsSync(path)).toBe(false)
})

it('refreshes the managed Pod identity and signals refresh failure without falling back to the owner', async () => {
  vi.useFakeTimers()
  const accessToken = vi.fn().mockResolvedValueOnce('FIRST_POD_TOKEN').mockResolvedValueOnce('SECOND_POD_TOKEN').mockRejectedValueOnce(new Error('Identity revoked'))
  const identity = await podIdentityFile(root, connection(accessToken))
  try {
    await vi.advanceTimersByTimeAsync(30000)
    await vi.waitFor(async () => expect(JSON.parse(await readFile(identity.path, 'utf8')).access_token).toBe('SECOND_POD_TOKEN'))
    expect(identity.secrets).toContain('FIRST_POD_TOKEN')
    expect(identity.secrets).toContain('SECOND_POD_TOKEN')
    await vi.advanceTimersByTimeAsync(30000)
    expect(identity.signal.aborted).toBe(true)
    expect(() => identity.assertActive()).toThrow('Identity revoked')
  }
  finally { await identity.close(); vi.useRealTimers() }
  expect(existsSync(identity.path)).toBe(false)
})

it('scopes Git credentials to the canonical HTTPS host and respects an explicit Pod identity', async () => {
  const file = join(root, 'pod-auth.json')
  await writeFile(file, JSON.stringify({ access_token: 'SYNTHETIC_GIT_POD' }))
  const helper = join(process.cwd(), 'scripts/git-credential-apes')
  const env = { ...process.env, HOME: join(root, 'no-owner-home'), APES_AUTH_FILE: file }
  const input = 'protocol=https\nhost=repos.openape.ai\n\n'
  const execute = (request = input, authFile = file, operation = 'get') => spawnSync('/bin/sh', [helper, operation], { env: { ...env, APES_AUTH_FILE: authFile }, input: request, encoding: 'utf8' })
  expect(execute()).toMatchObject({ status: 0, stdout: 'username=x-access-token\npassword=SYNTHETIC_GIT_POD\n' })
  for (const request of ['', 'protocol=http\nhost=repos.openape.ai\n\n', 'protocol=https\nhost=example.test\n\n', 'protocol=https\nhost=repos.openape.ai.example.test\n\n', 'protocol=https\nhost=repos.openape.ai:444\n\n', 'protocol=https\nhost=repos.openape.ai\nhost=example.test\n\n']) {
    expect(execute(request)).toMatchObject({ status: 0, stdout: '' })
  }
  for (const authFile of [join(root, 'missing'), '']) {
    const result = execute(input, authFile)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  }
  expect(execute(input, file, 'store')).toMatchObject({ status: 0, stdout: '' })
  await writeFile(file, JSON.stringify({ access_token: 'INVALID\nTOKEN' }))
  expect(execute().status).not.toBe(0)
  expect(execute().stdout).toBe('')
})
