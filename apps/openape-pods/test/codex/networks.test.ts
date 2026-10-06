// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexNetworks } from '../../src/worker/codex/networks'
import { boundedCodexNetworkResult, codexNetworkResult, parseCodexNetworkAction } from '../../src/contracts/codex-networks'
import { networkFixture, closeNetworks } from '../scheduling/network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

function fixture() {
  const f = networkFixture()
  const source = f.pod('Source', { gives: ['input'], takes: [], summary: 'Reads synthetic input' }, async () => {})
  const consumer = f.pod('Consumer', { gives: [], takes: ['input'], summary: 'Handles synthetic input' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['input'])
  const execute = vi.fn(async command => f.engine.execute(command))
  const owner = { ...f.owner }
  const control = new CodexNetworks(f.store, () => owner, execute)
  const send = (command: Record<string, unknown>, requestId = randomUUID()) => control.request({ id: requestId, action: { action: 'networks', command } })
  return { ...f, id, source, consumer, execute, owner, control, send }
}

it('reads bounded owned network details and rejects unowned networks and forged authority', async () => {
  const f = fixture()
  expect(await f.send({ type: 'list' })).toMatchObject({ networks: [{ id: f.id, state: 'paused' }] })
  expect(await f.send({ type: 'detail', id: f.id, revision: 1 })).toMatchObject({ details: { members: expect.arrayContaining([expect.objectContaining({ podId: f.source }), expect.objectContaining({ podId: f.consumer })]) } })
  await expect(f.send({ type: 'detail', id: f.id, revision: 2 })).rejects.toThrow()
  expect(() => parseCodexNetworkAction({ action: 'networks', command: { type: 'detail', id: f.id, revision: 1, ownerOperation: true } })).toThrow()
  for (const type of ['activate', 'gateOpen', 'choose', 'reconcileEffect', 'create']) expect(() => parseCodexNetworkAction({ action: 'networks', command: { type } })).toThrow()
  f.store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(f.owner.issuer, 'another-owner')
  f.store.db.prepare('UPDATE networks SET owner_subject=? WHERE id=?').run('another-owner', f.id)
  expect(await f.send({ type: 'list' })).toEqual({ networks: [] })
  await expect(f.send({ type: 'detail', id: f.id, revision: 1 })).rejects.toThrow()
})

it('replays exact preview and processing receipts without duplicate execution and retains pause', async () => {
  const f = fixture()
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.source)
  const command = { type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [f.source], budget: 1 }
  const requestId = randomUUID()
  const preview = await f.send(command, requestId)
  expect(await f.send(command, requestId)).toEqual(preview)
  expect(f.execute).toHaveBeenCalledTimes(1)
  await expect(f.send({ ...command, budget: 2 }, requestId)).rejects.toThrow('reused')
  const process = { type: 'process', id: f.id, revision: 1, previewId: preview.preview!.id }
  const processRequest = randomUUID()
  const started = await f.send(process, processRequest)
  expect(await f.send(process, processRequest)).toEqual(started)
  await expect.poll(() => f.started.length).toBe(1)
  expect(f.engine.view().networks[0]?.state).toBe('paused')
  expect(f.store.getPod(f.source).lifecycle).toBe('paused')
  f.owner.subject = 'different-owner'
  await expect(f.send(process, processRequest)).rejects.toThrow('owner')
})

it('does not retry an interrupted mutation and requires explicit paused-instance review', async () => {
  const f = fixture()
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.source)
  const requestId = randomUUID()
  const command = { type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }
  await expect(f.send(command, requestId)).rejects.toThrow('explicit review')
  await expect(f.send(command, requestId)).rejects.toThrow('failed or was interrupted')
  expect(f.execute).toHaveBeenCalledTimes(1)
  expect(f.started).toEqual([])
})

it('omits unrelated network choices and rejects oversized pages instead of truncating silently', () => {
  const f = fixture()
  const view = f.engine.view()
  const command = { type: 'detail' as const, id: f.id, revision: 1 }
  const unrelated = { ...view.networks[0]!, id: randomUUID() }
  expect(codexNetworkResult(command, { networks: [...view.networks, unrelated], choices: [{ networkId: unrelated.id, revision: 1, eventId: randomUUID(), caseId: randomUUID(), gate: 'review', title: 'Private other network', payload: 'do not expose', truncated: false, options: [{ key: 'yes', title: 'Yes' }] }] })).toMatchObject({ networks: [{ id: f.id }], choices: [] })
  expect(() => boundedCodexNetworkResult(command, { ...view, records: { collectionId: randomUUID(), records: Array.from({ length: 5 }, (_, index) => ({ key: String(index), revision: 1, schemaVersion: 1, body: '€'.repeat(196608), truncated: false, deleted: false, at: 1 })), after: null } })).toThrow('read limit')
})

it('redacts global diagnostics and retains a completed receipt when the response exceeds its limit', async () => {
  const f = fixture()
  const view = f.engine.view()
  view.networks[0]!.health.lastSchedulerError = 'Unrelated Pod private diagnostic'
  expect(codexNetworkResult({ type: 'detail', id: f.id, revision: 1 }, view).networks[0]!.health.lastSchedulerError).toBe('Runtime needs attention')
  const execute = vi.fn(async () => ({ ...view, records: { collectionId: randomUUID(), records: Array.from({ length: 5 }, (_, index) => ({ key: String(index), revision: 1, schemaVersion: 1, body: '€'.repeat(196608), truncated: false, deleted: false, at: 1 })), after: null } }))
  const control = new CodexNetworks(f.store, () => f.owner, execute)
  const request = { id: randomUUID(), action: { action: 'networks', command: { type: 'pause', id: f.id, revision: 1 } } }
  await expect(control.request(request)).rejects.toThrow('read limit')
  await expect(control.request(request)).rejects.toThrow('read limit')
  expect(execute).toHaveBeenCalledTimes(1)
  expect(f.store.db.prepare('SELECT state FROM master_actions WHERE id=?').get(`codex-network:${request.id}`)!.state).toBe('completed')
})
