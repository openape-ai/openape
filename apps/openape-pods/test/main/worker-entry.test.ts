// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { seedNetwork } from '../storage/network-fixture'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import type { RunServices } from '../../src/worker/runs/dispatcher'
import type { ProgramAuthority } from '../../src/main/programs/grants'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { CentralProjection } from '../../src/worker/central/projection'
import { MailBridge } from '../../src/worker/mail/bridge'
import { createPortablePackage } from '../../src/worker/sharing/package'

const captured = vi.hoisted(() => ({ services: undefined as RunServices | undefined, startControlled: undefined as ((podId: string, operationId: string) => string) | undefined }))
vi.mock('../../src/worker/runs/dispatcher', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/worker/runs/dispatcher')>()
  return { ...original, RunDispatcher: class extends original.RunDispatcher {
    constructor(...args: ConstructorParameters<typeof original.RunDispatcher>) {
      super(...args); captured.services = args[3]
    }
  } }
})

vi.mock('../../src/worker/master/control', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/worker/master/control')>()
  return { ...original, MasterControl: class extends original.MasterControl {
    constructor(...args: ConstructorParameters<typeof original.MasterControl>) {
      super(...args); captured.startControlled = args[5]
    }
  } }
})

// Loads the real worker process entry (src/worker/entry.ts) with Electron's
// parentPort replaced by an in-memory port and the scheduler interval driven by
// fake timers. Formerly the packaged `crash-recovery` suspend case: a suspend
// signal pauses intake, and resume catches missed slots up exactly once.
let root = ''; let listener: (event: { data: unknown }) => Promise<void> = async () => {}
const replies = vi.fn()
const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
function runs(podId: string): number {
  const store = new PodDatabase(root)
  try { return store.db.prepare('SELECT count(*) AS count FROM runs WHERE pod_id=?').get(podId)!.count as number }
  finally { store.close() }
}
const send = (data: unknown) => listener({ data })
// One scheduler interval plus real time for its asynchronous storage check and
// scan to finish; the worker skips intervals while a previous tick still runs.
async function tick() { await vi.advanceTimersByTimeAsync(1100); await new Promise(resolve => setTimeout(resolve, 300)) }

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-worker-entry-')))
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Scheduled example' })
  const registry = new ResourceRegistry(store, () => {})
  installExample(store, registry, pod.id, 'deterministic', 'a'.repeat(64))
  const scheduler = new Scheduler(store, new RunDispatcher(store, registry, {} as AgentRuntime))
  scheduler.save(pod.id, 0, { kind: 'interval', seconds: 60 }, true)
  store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)
  store.close()
  process.env.PODS_TEST_POD_ID = pod.id
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { postMessage: replies, on: (_event: string, callback: typeof listener) => { listener = callback } } })
  vi.stubEnv('PODS_RUNTIME_EXECUTABLE', process.execPath)
  await import('../../src/worker/entry')
  vi.mocked(process.cwd).mockRestore()
  await send({ id: 'provider', command: { provider: null } })
  await send({ id: 'startup-inspection', command: { inspectCredentials: true } })
  expect(replies).toHaveBeenCalledWith({ id: 'startup-inspection', state: true })
})
// Each test file runs in its own process; the loaded worker is discarded with it
// instead of being stopped (its stop path waits on timers that are faked here).
afterAll(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs()
  Reflect.deleteProperty(process, 'parentPort')
  await rm(root, { recursive: true, force: true })
})

it('holds the update fence across backup, blocks commands and resumes without editing saved schedules', async () => {
  await send('suspend')
  const store = new PodDatabase(root)
  const before = store.db.prepare('SELECT * FROM schedules ORDER BY pod_id').all()
  store.close()
  await send({ id: 'update-freeze', command: { data: { type: 'prepareUpdate' } } })
  expect(replies).toHaveBeenCalledWith({ id: 'update-freeze', state: true })
  await send({ id: 'update-blocked', command: { type: 'pauseAll' } })
  expect(replies).toHaveBeenCalledWith({ id: 'update-blocked', error: expect.stringContaining('maintained') })
  await send({ id: 'update-release', command: { data: { type: 'releaseUpdate' } } })
  expect(replies).toHaveBeenCalledWith({ id: 'update-release', state: true })
  const after = new PodDatabase(root)
  try { expect(after.db.prepare('SELECT * FROM schedules ORDER BY pod_id').all()).toEqual(before) }
  finally { after.close() }
})

it('pauses scheduled intake while suspended and catches missed slots up once on resume', async () => {
  const podId = process.env.PODS_TEST_POD_ID!
  await send('suspend')
  const store = new PodDatabase(root)
  try { store.db.prepare('UPDATE schedules SET next_at=? WHERE pod_id=?').run(Date.now() - 600000, podId) }
  finally { store.close() }
  await tick(); await tick()
  expect(runs(podId)).toBe(0)
  await send('resume')
  await tick()
  await vi.waitFor(() => expect(runs(podId)).toBe(1))
  await tick(); await tick()
  expect(runs(podId)).toBe(1)
  expect(exit).not.toHaveBeenCalledWith(1)
})

it('routes assigned SSH observations through the real worker entry without requiring mail access', async () => {
  const store = new PodDatabase(root)
  const bridge = vi.spyOn(MailBridge.prototype, 'execute').mockResolvedValue({ version: 1, profile: 'linde-server-v1', facts: { observedAt: '2026-09-30T14:00:00Z' } })
  try {
    const pod = store.createPod({ name: 'SSH inventory' }); const registry = new ResourceRegistry(store, () => {})
    registry.assignSsh(pod.id, { target: { alias: 'fixture.example', jumps: [], profile: 'linde-server-v1' }, profileHash: 'a'.repeat(64), hosts: [], knownHosts: [] }, { identity: { podId: pod.id }, grantId: 'approved' } as ProgramAuthority, 0)
    const resource = registry.list(pod.id)[0]!
    const scope = { podId: pod.id, runId: pod.id, epoch: 1, assignmentRevision: 1, capabilities: [resource.configuration.capability as string], root, assertCurrent: () => {}, registerDomain: () => {} }
    const invoke = captured.services!.tool!
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, scope)).resolves.toMatchObject({ version: 1, facts: { observedAt: '2026-09-30T14:00:00Z' } })
    expect(bridge).toHaveBeenCalledTimes(1)
    await expect(invoke({ sshInventory: resource.id, command: 'id' }, new AbortController().signal, scope)).rejects.toThrow()
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, { ...scope, capabilities: [] })).rejects.toThrow()
    registry.revoke(pod.id, resource.id, resource.revision)
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, scope)).rejects.toThrow()
    expect(bridge).toHaveBeenCalledTimes(1)
  }
  finally { bridge.mockRestore(); store.close() }
})

it('lists descriptions with the workspace and routes a description command through the real worker', async () => {
  await send({ id: 'workspace-list', command: { type: 'list' } })
  expect(replies).toHaveBeenCalledWith({ id: 'workspace-list', state: expect.objectContaining({ descriptions: [], pods: expect.arrayContaining([expect.objectContaining({ name: 'Scheduled example' })]) }) })
  await send({ id: 'describe-unknown', command: { type: 'describeAutomation', id: randomUUID(), revision: 0, text: 'Nothing to describe' } })
  expect(replies).toHaveBeenCalledWith({ id: 'describe-unknown', error: 'Network not found' })
  await send({ id: 'describe-forged', command: { type: 'describeAutomation', id: randomUUID(), revision: 0, text: 'Purpose', owner: 'forged' } })
  expect(replies).toHaveBeenCalledWith({ id: 'describe-forged', error: 'Unsupported workspace command' })
})

it('validates the local network route before mutation', async () => {
  await send({ id: 'networks-list', command: { networks: { type: 'list' } } })
  expect(replies).toHaveBeenCalledWith({ id: 'networks-list', state: { networks: [] } })
  await send({ id: 'networks-invalid', command: { networks: { type: 'list', owner: 'forged' } } })
  expect(replies).toHaveBeenCalledWith(expect.objectContaining({ id: 'networks-invalid', error: expect.any(String) }))
  await send({ id: 'networks-unreviewed', command: { networks: { type: 'create', draft: { name: 'Unreviewed', groupId: randomUUID(), channels: [], members: [{ podId: randomUUID(), source: { schedule: null }, serialCase: false }] } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'networks-unreviewed', error: 'Network creation requires a reviewed setup fingerprint' })
})

it('prevents reviewed master and browser starts from bypassing the suspended production runtime', async () => {
  const store = new PodDatabase(root)
  let podId = ''
  try {
    const pod = store.createPod({ name: 'Controlled start fixture' }); podId = pod.id
    installExample(store, new ResourceRegistry(store, () => {}), pod.id, 'deterministic', 'a'.repeat(64))
  }
  finally { store.close() }
  await send('suspend')
  try {
    expect(captured.startControlled).toBeTypeOf('function')
    expect(() => captured.startControlled!(podId, randomUUID())).toThrow('ready local runtime')
    expect(runs(podId)).toBe(0)
  }
  finally { await send('resume') }
})

it('starts only the requested local owner run while the central scheduler gate is closed', async () => {
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Serialized MCP run' })
  store.close()
  const runId = randomUUID()
  const start = vi.spyOn(RunDispatcher.prototype, 'start').mockReturnValue(runId)
  const scheduled = vi.spyOn(Scheduler.prototype, 'tick')
  const networkTick = vi.spyOn(NetworkEngine.prototype, 'tick')
  const action = { action: 'run', podId: pod.id, revision: pod.revision }
  const request = { id: randomUUID(), action }
  try {
    await send({ id: 'close-owner-gate', command: { central: { type: 'gate', until: 0 } } })
    await send({ id: 'select-owner-pod', command: { codex: { id: randomUUID(), action: { action: 'select', podIds: [pod.id] } } } })
    await send({ id: 'untrusted-start', command: { codex: { id: randomUUID(), action } } })
    expect(replies).toHaveBeenCalledWith({ id: 'untrusted-start', error: expect.stringContaining('ready local runtime') })
    await send({ id: 'forged-start', command: { codex: { id: randomUUID(), action: { ...action, ownerOperation: true } } } })
    expect(replies).toHaveBeenCalledWith({ id: 'forged-start', error: expect.any(String) })
    expect(start).not.toHaveBeenCalled()
    await send({ id: 'owner-start', command: { codex: request, ownerOperation: true } })
    expect(replies).toHaveBeenCalledWith({ id: 'owner-start', state: { runId } })
    await send({ id: 'owner-replay', command: { codex: request, ownerOperation: true } })
    expect(replies).toHaveBeenCalledWith({ id: 'owner-replay', state: { runId } })
    expect(start).toHaveBeenCalledExactlyOnceWith(pod.id, { reason: 'manual', eventIds: [], operationId: `codex:${request.id}` }, undefined)
    expect(scheduled).not.toHaveBeenCalled()
    expect(networkTick).not.toHaveBeenCalled()
    await send('suspend')
    await send({ id: 'suspended-owner-start', command: { codex: { id: randomUUID(), action }, ownerOperation: true } })
    expect(replies).toHaveBeenCalledWith({ id: 'suspended-owner-start', error: expect.stringContaining('ready local runtime') })
    expect(start).toHaveBeenCalledTimes(1)
  }
  finally {
    start.mockRestore(); scheduled.mockRestore(); networkTick.mockRestore()
    await send('resume')
    await send({ id: 'restore-owner-gate', command: { central: { type: 'gate', until: Date.now() + 3600000 } } })
  }
})

it('rechecks network browser mutation authority in the real worker when an older relay lacks the guard', async () => {
  const store = new PodDatabase(root)
  const network = seedNetwork(store)
  store.close()
  await send({ id: 'network-legacy-start', command: { central: { type: 'assertCommand', command: { channel: 'runs', body: { type: 'start', podId: network.pod.id } } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'network-legacy-start', error: expect.stringContaining('desktop review') })
  await send({ id: 'network-safe-pause', command: { central: { type: 'assertCommand', command: { channel: 'scheduling', body: { type: 'lifecycle', podId: network.pod.id, revision: 1, lifecycle: 'paused' } } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'network-safe-pause', state: true })
  await send({ id: 'network-describe', command: { central: { type: 'assertCommand', command: { channel: 'details', body: { type: 'describe', podId: network.pod.id, revision: 0, text: 'Explains this member' } } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'network-describe', state: true })
  await send({ id: 'network-describe-collection', command: { central: { type: 'assertCommand', command: { channel: 'workspace', body: { type: 'describeAutomation', id: network.networkId, revision: 0, text: 'Explains this network' } } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'network-describe-collection', state: true })
  await send({ id: 'network-activate', command: { central: { type: 'assertCommand', command: { channel: 'details', body: { type: 'activate', podId: network.pod.id, hash: 'a'.repeat(64), expectedActive: null, assignmentRevision: 1 } } } } })
  expect(replies).toHaveBeenCalledWith({ id: 'network-activate', error: expect.stringContaining('desktop review') })
})
it('routes validated portable import commands through the real worker only after identity setup', async () => {
  const exported = await createPortablePackage({
    format: 'openape-package', version: 1, package: { key: 'fixture', revision: 1, title: 'Portable fixture', description: '' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind: 'pod', key: 'fixture' }, applications: [], compositions: [],
    pods: [{ key: 'fixture', title: 'Imported through entry', description: '', script: 'pods/fixture/run.mjs', packages: null, contract: null, requestedCapabilities: [], access: [], inputs: [], bindings: [], applications: [], assets: [] }],
  }, [{ path: 'pods/fixture/run.mjs', kind: 'script', mediaType: 'text/javascript', content: new TextEncoder().encode('export async function run() { return { status: "completed" } }') }], '')
  const id = randomUUID()
  await send({ id: 'import-forged', command: { sharing: { scope: 'import', type: 'list', owner: 'forged' } } })
  expect(replies).toHaveBeenCalledWith({ id: 'import-forged', error: 'Invalid import command' })
  await send({ id: 'import-early', command: { sharing: { scope: 'import', type: 'stage', id, archive: exported.archive } } })
  expect(replies).toHaveBeenCalledWith({ id: 'import-early', error: 'Finish desktop identity setup before sharing packages' })
  const store = new PodDatabase(root)
  try {
    store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: { issuer: 'https://id.example.test', subject: 'recipient' } }))
    const before = store.listPods().length
    await send({ id: 'import-stage', command: { sharing: { scope: 'import', type: 'stage', id, archive: exported.archive } } })
    await send({ id: 'import-commit', command: { sharing: { scope: 'import', type: 'commit', id, revision: 1 } } })
    expect(replies).toHaveBeenCalledWith({ id: 'import-commit', state: expect.objectContaining({ current: expect.objectContaining({ state: 'committed', unresolved: [] }) }) })
    await send({ id: 'import-complete', command: { sharing: { scope: 'import', type: 'complete', id, revision: 2 } } })
    expect(replies).toHaveBeenCalledWith({ id: 'import-complete', state: expect.objectContaining({ imports: [], current: expect.objectContaining({ state: 'completed' }) }) })
    expect(store.listPods().slice(before)).toMatchObject([{ name: 'Imported through entry', lifecycle: 'paused', activeScript: null }])
  }
  finally { store.db.exec('DELETE FROM remote_registration'); store.close() }
})

it('keeps browser decision reads scoped to the requested network and omits choices from traces', async () => {
  const first = randomUUID(); const second = randomUUID()
  const choices = [first, second].map(networkId => ({ networkId, revision: 1, eventId: randomUUID(), caseId: randomUUID(), gate: 'review', title: 'Review', payload: 'private choice', truncated: false, options: [{ key: 'keep', title: 'Keep' }, { key: 'other', title: 'Other' }] }))
  const ownerCheck = vi.spyOn(CentralProjection.prototype, 'assertOwner').mockImplementation(() => {})
  const execute = vi.spyOn(NetworkEngine.prototype, 'execute').mockImplementation(() => ({ networks: [], choices: structuredClone(choices) }))
  try {
    const owner = { issuer: 'https://identity.example.invalid', subject: 'owner' }
    await send({ id: 'scoped-choice-detail', command: { central: { type: 'networkRead', owner, command: { type: 'detail', id: first, revision: 1 } } } })
    expect(replies).toHaveBeenCalledWith({ id: 'scoped-choice-detail', state: { networks: [], choices: [choices[0]], gates: undefined } })
    await send({ id: 'scoped-choice-trace', command: { central: { type: 'networkRead', owner, command: { type: 'trace', id: first, revision: 1, before: null, caseId: null } } } })
    expect(replies).toHaveBeenCalledWith({ id: 'scoped-choice-trace', state: { networks: [] } })
  }
  finally { execute.mockRestore(); ownerCheck.mockRestore() }
})
