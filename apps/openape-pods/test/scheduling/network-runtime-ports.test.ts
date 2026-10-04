// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { executeAgent } from '../../src/worker/agent/executor'
import { closeNetworks, networkFixture } from './network-fixture'
import { defaultJevModel, parseJevRequest, syntheticJevResult } from '../../src/contracts/jev'
import { SetupControl } from '../../src/worker/onboarding/control'
import type { ProgramAssignment } from '../../src/contracts/programs'

vi.mock('../../src/worker/agent/executor', () => ({ executeAgent: vi.fn() }))
vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

function validateCapabilities(f: ReturnType<typeof networkFixture>, podId: string, capabilities: string[]) {
  const pod = f.store.getPod(podId)
  const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript!)!
  const manifest = JSON.parse(row.manifest as string)
  f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify({ ...manifest, capabilities }), podId, pod.activeScript!)
  f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, pod.activeScript!, pod.bindingRevision, f.resources.epoch(podId), '{}')
}

it('executes assigned program reads within the network authority and read budget', async () => {
  const tool = vi.fn(async (_body: unknown, _signal: AbortSignal, scope: { assertCurrent: () => void }) => { scope.assertCurrent(); return { stdout: '[]', stderr: '', exitCode: 0 } })
  const f = networkFixture({ tool })
  const applicationId = randomUUID()
  const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
  let checked = false
  const source = f.pod('Assigned CLI source', { takes: [], gives: ['input'], summary: 'Read source' }, async (_items, invoke) => {
    await expect(invoke('tools.invoke', { application: 'foreign', argv: ['list'] })).rejects.toThrow('not declared and assigned')
    await expect(invoke('tools.invoke', { application: 'mail', argv: ['list'], untrusted: true })).rejects.toThrow('Invalid application')
    await expect(invoke('http.request', { url: 'https://example.invalid' })).rejects.toThrow('runtime port')
    for (let count = 0; count < 100; count++) await expect(invoke('tools.invoke', { application: 'mail', argv: ['list'] })).resolves.toMatchObject({ exitCode: 0 })
    await expect(invoke('tools.invoke', { application: 'mail', argv: ['list'] })).rejects.toThrow('read budget')
    checked = true
  })
  const consumer = f.pod('Consumer', { takes: ['input'], gives: [], summary: 'Consume' }, async () => {})
  f.resources.assignProgram(source, applicationId, { type: 'program', name: 'mail', capability } as ProgramAssignment, f.resources.epoch(source))
  validateCapabilities(f, source, [capability])
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])
  f.process(id, [source], [source], 1); f.engine.tick()
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(source)?.state).toBe('completed')
  expect(checked).toBe(true)
  expect(tool).toHaveBeenCalledTimes(100)
  expect(f.engine.view().networks[0]!.state).toBe('paused')
})

it.each(['settle', 'cancel', 'revoke', 'failure'] as const)('fences Jev network results on %s and retains input without external effects', async (outcome) => {
  const request = parseJevRequest({ state: 'Private synthetic mail', questions: { useful: { type: 'noul', instructions: 'Useful?' } } })
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const jev = vi.fn(async () => { await waiting; if (outcome === 'failure') throw new Error('Provider unavailable'); return { result: syntheticJevResult(request, defaultJevModel), attempts: 1 } })
  const f = networkFixture({ jev })
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Read' }, async () => {})
  const consumer = f.pod('Jev', { takes: ['input'], gives: [], summary: 'Classify' }, async (_items, invoke) => { await invoke('jev.evaluate', request) })
  const connectionId = randomUUID()
  new SetupControl(f.store, f.resources).execute({ type: 'save', connection: { id: connectionId, provider: 'typesafe', account: 'Jev', state: 'ready', error: null }, metadata: { verifiedAt: 1 } })
  f.resources.assignJev(consumer, connectionId, defaultJevModel, 3, { ownerConnection: randomUUID(), grantId: 'synthetic', identity: { connectionId: randomUUID(), podId: consumer, issuer: f.owner.issuer, owner: f.owner.subject, subject: 'synthetic-pod', keyId: 'synthetic' } }, f.resources.epoch(consumer))
  validateCapabilities(f, consumer, ['jev.evaluate'])
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])
  f.process(id, [consumer], [consumer], 1); f.engine.tick()
  expect(jev).not.toHaveBeenCalled()
  const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
  await f.engine.invocations.finish(authority, 'completed', 'Source', null, [], [{ channel: 'input', key: 'one', sourceItemId: 'one', sourceVersion: 'provider-v1', payload: { subject: 'Synthetic' } }])
  f.process(id, [consumer], [consumer], 1); f.engine.tick()
  await expect.poll(() => jev.mock.calls.length).toBe(1)
  if (outcome === 'cancel') f.dispatcher.cancelPod(consumer)
  if (outcome === 'revoke') f.store.db.prepare('UPDATE resource_epochs SET epoch=epoch+1 WHERE pod_id=?').run(consumer)
  f.engine.execute({ type: 'pause', id, revision: 1 })
  release()
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(consumer)?.state).not.toBe('running')
  const delivery = f.store.db.prepare('SELECT state FROM network_deliveries').get()!
  expect(delivery.state).toBe(outcome === 'settle' ? 'done' : 'blocked')
  expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
  expect(f.store.db.prepare('SELECT * FROM network_effect_attempts').all()).toEqual([])
  expect(JSON.stringify(f.engine.execute({ type: 'trace', id, revision: 1, before: null, caseId: null }))).not.toContain(request.state)
})

it('allows bounded text generation without tools and refuses tool authority or extra calls', async () => {
  vi.mocked(executeAgent).mockResolvedValue({ threadId: 'synthetic', response: '{"text":"Preview"}' })
  const f = networkFixture({ provider: async () => new Response('{}') })
  let checked = false
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Source' }, async (_items, invoke) => {
    await expect(invoke('agent.run', { prompt: 'Synthetic preview', tools: ['ape_shell'] })).rejects.toThrow('no tools')
    await expect(invoke('agent.run', { prompt: 'Synthetic preview', tools: [], timeoutSeconds: 121 })).rejects.toThrow('120 seconds')
    for (let count = 0; count < 50; count++) await expect(invoke('agent.run', { prompt: 'Synthetic preview', tools: [], timeoutSeconds: 120 })).resolves.toMatchObject({ response: '{"text":"Preview"}' })
    await expect(invoke('agent.run', { prompt: 'Synthetic preview', tools: [] })).rejects.toThrow('budget exceeded')
    checked = true
  })
  const consumer = f.pod('Consumer', { takes: ['input'], gives: [], summary: 'Consumer' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])
  f.process(id, [source], [], 1)
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(source)?.state).toBe('completed')
  expect(checked).toBe(true)
  expect(executeAgent).toHaveBeenCalledTimes(50)
  expect(vi.mocked(executeAgent).mock.calls.every(call => call[7]?.length === 0 && call[8] === 120)).toBe(true)
  expect(f.engine.view().networks[0]!.state).toBe('paused')
})

it('refuses assigned program reads on consumer members before creating the network', () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['input'], summary: 'Read' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['input'], gives: [], summary: 'Consume' }, async () => {})
  const applicationId = randomUUID(); const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
  f.resources.assignProgram(consumer, applicationId, { type: 'program', name: 'mail', capability } as ProgramAssignment, f.resources.epoch(consumer))
  validateCapabilities(f, consumer, [capability])
  expect(() => f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])).toThrow('declared source')
  expect(f.engine.view().networks).toEqual([])
})
