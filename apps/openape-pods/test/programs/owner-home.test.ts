// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
vi.mock('../../src/main/broker/authorization', () => ({ AgentAuthority: class { async authorize() {} async assertActive() {} } }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'synthetic' }), resolveCommand: async () => ({ detail: { action: 'list' } }), exactCommand: (resolved: unknown) => resolved }))

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

async function brokerCall(level: SandboxLevel) {
  const program = await executable(); const stateId = await new ProgramState(credentials).create({ podId, applicationId })
  const argv = ['az', 'repos', 'pr', 'list']
  const assignment: ToolAssignment = { id: applicationId, grantId: '', command: { cliId: 'az', adapterPath: '/fixture/az.toml', adapterDigest: 'synthetic', argv, coverage: [] }, reach: reach(level), programState: { id: stateId, podId, applicationId }, capability: 'tool.az.invoke', executable: program.path, executableHash: program.hash, entryFiles: [], prefix: [], runtimeDirectories: [], environment: {}, runtimeEnvironment: { HOME: '/descriptor/home' }, networkPorts: [] }
  const broker = new PodToolBroker('/fixture/helper', join(root, 'broker'), { authorize: async () => {} } as never, credentials)
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
  const adapter = join(root, 'az.toml'); await writeFile(adapter, 'synthetic')
  const assignment = { type: 'program', name: 'az', cliId: 'az', executable: program.path, executableHash: program.hash, adapterPath: adapter, adapterHash: createHash('sha256').update('synthetic').digest('hex'), stateId, capability: 'tool.az.invoke', networkHosts: [], entryFiles: [], environment: {} } as unknown as ProgramAssignment
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
