// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexNetworks } from '../../src/worker/codex/networks'
import { boundedCodexNetworkResult, codexNetworkResult, parseCodexNetworkAction } from '../../src/contracts/codex-networks'
import type { CodexNetworkCommand } from '../../src/contracts/codex-networks'
import { codexTool } from '../../src/contracts/codex'
import type { GraphContract } from '../../src/contracts/graphs'
import type { NetworkGateManifest } from '../../src/contracts/network-gates'
import { digest } from '../../src/worker/storage/database'
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
  expect(() => parseCodexNetworkAction({ action: 'networks', command: { type: 'replacementSetup', id: f.id, revision: 1 } })).toThrow('Unsupported network command')
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

it('accepts member script maintenance only through the local assistant connection', () => {
  const f = fixture()
  const hash = 'a'.repeat(64)
  expect(parseCodexNetworkAction({ action: 'networks', command: { type: 'updateMemberScript', id: f.id, revision: 1, podId: f.consumer, hash } })).toEqual({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.consumer, hash })
  expect(parseCodexNetworkAction({ action: 'networks', command: { type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer } })).toMatchObject({ type: 'replayFailed' })
  expect(parseCodexNetworkAction({ action: 'networks', command: { type: 'reconcileEffect', id: f.id, revision: 1, runId: f.id, generation: 1, key: 'b'.repeat(64), attempt: 1, sequence: 2, outcome: 'confirmed_not_applied', evidence: 'Refused before dispatch' } })).toMatchObject({ type: 'reconcileEffect', outcome: 'confirmed_not_applied' })
  expect(parseCodexNetworkAction({ action: 'networks', command: { type: 'discardFailure', id: f.id, revision: 1, runId: f.id, generation: 2, evidence: 'All effects reconciled' } })).toMatchObject({ type: 'discardFailure', generation: 2 })
  expect(() => parseCodexNetworkAction({ action: 'networks', command: { type: 'updateMemberScript', id: f.id, revision: 1, podId: f.consumer, hash: 'not-a-hash' } })).toThrow('hash')
  expect(() => f.engine.execute({ type: 'updateMemberScript', id: f.id, revision: 1, podId: f.consumer, hash })).toThrow('local assistant connection')
  expect(() => f.engine.execute({ type: 'replayFailed', id: f.id, revision: 1, podId: f.consumer })).toThrow('local assistant connection')
})

const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }
const channel = (name: string) => ({ name, title: name, schemaVersion: 1, schema })

// The worker executes MCP network commands through the same engine entry points as the desktop.
function ownerSession(f: ReturnType<typeof networkFixture>) {
  const execute = async (command: CodexNetworkCommand) => {
    if (command.type === 'updateMemberScript') return f.engine.updateMemberScript(command)
    if (command.type === 'inspect' || command.type === 'retry' || command.type === 'reconcileEffect' || command.type === 'resolveConflict' || command.type === 'discardFailure') return f.engine.recover(command)
    return f.engine.execute(command)
  }
  const control = new CodexNetworks(f.store, () => f.owner, execute)
  return (command: Record<string, unknown>, requestId = randomUUID()) => control.request({ id: requestId, action: { action: 'networks', command } })
}

// Stores a script version as validation would: same binding manifest, new code, validated for the current resources.
function validatedScript(f: ReturnType<typeof networkFixture>, podId: string, contract: GraphContract) {
  const active = f.store.getPod(podId).activeScript!
  const manifest = JSON.parse(f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, active)!.manifest as string)
  const code = `export const contract=${JSON.stringify(contract)};\n// changed member\nexport async function run(context) { return {status:'completed',summary:'Updated',completedInputIds:context.input.eventIds,gapIds:[]}; }\n`
  const hash = digest(code)
  f.store.storeScript(podId, { ...manifest, contentHash: hash, contract }, code)
  f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, hash, f.store.getPod(podId).bindingRevision, f.resources.epoch(podId), '{"synthetic":true}')
  return hash
}

it('creates, activates and changes a joined network with a daily source through MCP', async () => {
  const f = networkFixture()
  const source = f.pod('Morning sources', { takes: [], gives: ['mail.digest', 'calendar.digest'], summary: 'Reads mail and calendar' }, async () => {})
  const editor = f.pod('Editor', { takes: ['calendar.digest', 'mail.digest'], gives: ['briefing'], summary: 'Writes the briefing' }, async () => {})
  const bot = f.pod('Calendar bot', { takes: ['briefing'], gives: [], summary: 'Files the briefing' }, async () => {})
  const send = ownerSession(f)
  const { setup } = await send({ type: 'setup', groupId: f.groupId, podIds: [source, editor, bot] })
  const daily = { kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' }
  const draft = {
    name: 'Morning briefing', groupId: f.groupId, expectedSetup: setup!.fingerprint,
    channels: ['mail.digest', 'calendar.digest', 'briefing'].map(channel),
    members: [{ podId: source, source: { schedule: daily }, serialCase: false }, { podId: editor, source: null, serialCase: true }, { podId: bot, source: null, serialCase: false }],
    joins: [{ id: 'morning', podId: editor, channels: ['mail.digest', 'calendar.digest'], deadlineMs: 3600000, reviewDestination: 'owner' }],
  }
  await expect(send({ type: 'create', draft: { ...draft, expectedSetup: 'f'.repeat(64) } })).rejects.toThrow('Network setup changed')

  const requestId = randomUUID()
  const created = await send({ type: 'create', draft }, requestId)
  const id = created.createdId!
  expect(created.networks).toMatchObject([{ id, name: 'Morning briefing', state: 'paused' }])
  expect(await send({ type: 'create', draft }, requestId)).toEqual(created)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM networks').get()!.n).toBe(1)
  const { details } = await send({ type: 'detail', id, revision: 1 })
  expect(details!.definition).toMatchObject({ formatVersion: 6, routes: [], feedback: [], joins: [{ id: 'morning', podId: editor, channels: ['calendar.digest', 'mail.digest'] }] })
  expect(details!.definition.members.find(member => member.podId === source)!.source!.schedule).toEqual(daily)

  expect((await send({ type: 'activate', id, revision: 1 })).networks).toMatchObject([{ id, state: 'active' }])
  expect(f.store.db.prepare('SELECT next_at FROM network_source_clocks WHERE network_id=? AND pod_id=?').get(id, source)!.next_at).toBeGreaterThan(Date.now())

  const hash = validatedScript(f, bot, { takes: ['briefing'], gives: [], summary: 'Files the briefing' })
  await send({ type: 'updateMemberScript', id, revision: 1, podId: bot, hash })
  expect(f.store.getPod(bot).activeScript).toBe(hash)
  expect(f.store.db.prepare('SELECT state FROM networks WHERE id=?').get(id)!.state).toBe('active')
  expect((await send({ type: 'pause', id, revision: 1 })).networks).toMatchObject([{ id, state: 'paused' }])
})

it('routes a choose gate decision through MCP exactly once', async () => {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['mail.unsure'], summary: 'Source' }, async () => {})
  const consumer = f.pod('Selected', { takes: ['mail.selected'], gives: [], summary: 'Selected' }, async () => {})
  const id = f.engine.execute({ type: 'create', draft: {
    name: 'Routed network', groupId: f.groupId, channels: ['mail.unsure', 'mail.selected'].map(channel),
    members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }],
    routes: [{ key: 'review', title: 'Choose a route', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep', channel: 'mail.selected' }, { key: 'other', title: 'Other', channel: 'mail.selected' }] }],
  } }).createdId!
  const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual', true)!
  await f.engine.invocations.finish(authority, 'completed', 'Synthetic input', null, [], [{ channel: 'mail.unsure', key: 'one', sourceItemId: 'one', sourceVersion: 'v1', payload: { subject: 'One' } }])
  const send = ownerSession(f)
  const choice = (await send({ type: 'detail', id, revision: 1 })).choices![0]!
  const command = { type: 'choose', id, revision: 1, eventId: choice.eventId, gate: choice.gate, option: 'keep' }
  const requestId = randomUUID()

  await send(command, requestId)
  await send(command, requestId)

  expect((await send({ type: 'detail', id, revision: 1 })).choices).toBeUndefined()
  const routed = f.store.db.prepare('SELECT channel,origin FROM network_events ORDER BY accepted_at,rowid').all().at(-1)!
  expect(routed.channel).toBe('mail.selected')
  expect(JSON.parse(routed.origin as string)).toMatchObject({ gate: 'review', decision: 'keep' })
})

it('decides approval batch grants only through the owner-session grants action, never through network commands', async () => {
  // Owner decision October 10, 2026 (issue 1455): grant decisions go through the one grants action of the owner session.
  expect(codexTool.inputSchema.properties.action.enum.filter(action => /approv|deny|grant/i.test(action))).toEqual(['grants'])
  const unknown = randomUUID()
  for (const type of ['approve', 'deny', 'approveGate', 'denyGate', 'gateApprove', 'gateDeny', 'gateExclude', 'grant']) expect(() => parseCodexNetworkAction({ action: 'networks', command: { type, id: unknown, revision: 1, taskId: unknown, generation: 1 } })).toThrow('Unsupported network command')

  const calls: string[] = []
  const f = networkFixture({ gate: async (value, _signal, scope) => {
    scope.assertCurrent()
    const body = value as { operation: string, manifest: NetworkGateManifest, grants?: { key: string, id: string }[] }
    f.engine.gates.authorizeService(scope, body.manifest, body.operation, body.grants)
    calls.push(body.operation)
    if (body.operation === 'create') return { id: body.manifest.id, url: 'https://identity.example.invalid/decision', grants: body.manifest.items.map(item => ({ key: item.deliveryId, id: `synthetic-once-grant-${item.deliveryId}` })) }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, 'pending']))
    if (body.operation === 'assertActive') return true
    throw new Error('Unexpected synthetic gate operation')
  } })
  const source = f.pod('Source', { takes: [], gives: ['test.input'], summary: 'Source' }, async () => {})
  const consumer = f.pod('Gated consumer', { takes: ['test.approved'], gives: [], summary: 'Consumer' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['test.input', 'test.approved'], [{ key: 'review', kind: 'approve', title: 'Review exact input', takes: 'test.input', gives: 'test.approved', excluded: null }])
  const send = ownerSession(f)
  await send({ type: 'activate', id, revision: 1 })
  const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
  await f.engine.invocations.finish(authority, 'completed', 'Synthetic source', null, [], [{ channel: 'test.input', key: 'one', sourceItemId: 'one', sourceVersion: 'v1', payload: { subject: 'One' } }])
  f.engine.tick()
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
  const batch = (await send({ type: 'detail', id, revision: 1 })).gates![0]!
  expect(batch).toMatchObject({ state: 'pending', url: null })

  await expect(send({ type: 'gateReview', id, revision: 1, taskId: batch.id, generation: batch.generation, evidence: 'Approve this batch for the owner' })).rejects.toThrow('Only obsolete')
  await expect(send({ type: 'gateDiscard', id, revision: 1, taskId: batch.id, generation: batch.generation, evidence: 'Deny this batch for the owner' })).rejects.toThrow('Only uncertain')

  expect((await send({ type: 'detail', id, revision: 1 })).gates![0]).toMatchObject({ id: batch.id, state: 'pending' })
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').all().map(task => task.state)).toEqual(['pending'])
  expect(f.store.db.prepare('SELECT outcome FROM network_gate_items').all().map(item => item.outcome)).toEqual(['held'])
  expect(calls.filter(operation => !['create', 'status', 'assertActive'].includes(operation))).toEqual([])
  expect(f.started).not.toContain(consumer)
})
