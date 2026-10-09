// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { fenceNetworkBoot } from '../../src/worker/scheduling/network-boot'
import { restoreNetworkStorage } from '../../src/worker/storage/network-restore'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateLimits } from '../../src/contracts/gate-limits'
import { networkGateActionHash, networkGateDigest, networkGateItemCommand, networkGatePayloadHash, parseNetworkGateCoverage, parseNetworkGateManifest, parseNetworkGateReleases } from '../../src/contracts/network-gates'
import type { NetworkGateManifest } from '../../src/contracts/network-gates'
import { parseNetworkDefinition } from '../../src/contracts/networks'
import { canonicalNetworkJson } from '../../src/worker/scheduling/network-events'
import { digest, PodDatabase } from '../../src/worker/storage/database'
import { upgradeNetworkDefinition } from '../../src/worker/storage/network-format-migration'
import { assertNetworkStorage } from '../../src/worker/storage/network-schema'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

function manifest(): NetworkGateManifest {
  const base = { version: 2 as const, id: randomUUID(), networkId: randomUUID(), networkRevision: 1, gate: 'review', title: 'Review input', podId: randomUUID(), owner: { issuer: 'https://identity.example.invalid', subject: 'synthetic-owner' }, restoreNonce: randomUUID(), activationEpoch: 1, definitionId: randomUUID(), definitionVersion: 1, bindingRevision: 1, assignmentRevision: 1, resourceEpoch: 0, scriptHash: 'a'.repeat(64), expiresAt: Date.now() + 60000, items: [{ deliveryId: randomUUID(), eventId: randomUUID(), generation: 0, key: 'one', hash: networkGatePayloadHash({ subject: 'One', revision: 1 }), channel: 'input.ready', title: 'One' }] }
  const action = { ...base, actionHash: networkGateActionHash(base) }
  return { ...action, digest: networkGateDigest(action) }
}

describe('versioned gate authority', () => {
  it('binds network inputs and all consumer authority pins to the grant command', () => {
    const frozen = manifest()
    expect(parseNetworkGateManifest(frozen)).toEqual(frozen)
    const item = frozen.items[0]!
    const command = JSON.parse(networkGateItemCommand(frozen, item)[2]!)
    expect(command).toMatchObject({ version: 2, podId: frozen.podId, networkId: frozen.networkId, definitionId: frozen.definitionId, resourceEpoch: 0, actionHash: frozen.actionHash, digest: frozen.digest, count: 1, item: { deliveryId: item.deliveryId, eventId: item.eventId, generation: 0, hash: item.hash, channel: item.channel } })
    for (const change of [{ podId: randomUUID() }, { definitionVersion: 2 }, { bindingRevision: 2 }, { assignmentRevision: 2 }, { resourceEpoch: 1 }, { scriptHash: 'b'.repeat(64) }, { restoreNonce: randomUUID() }, { activationEpoch: 2 }, { networkRevision: 2 }, { expiresAt: frozen.expiresAt + 1 }]) expect(() => parseNetworkGateManifest({ ...frozen, ...change })).toThrow('frozen digest')
  })

  it('adds explicit v3 data/configuration authority without changing historical v2 fields', () => {
    const old = manifest()
    const { digest: _digest, actionHash: _actionHash, ...previous } = old
    const base = { ...previous, version: 3 as const, dataPin: 'c'.repeat(64) }
    const action = { ...base, actionHash: networkGateActionHash(base) }
    const current = { ...action, digest: networkGateDigest(action) }
    expect(parseNetworkGateManifest(current)).toEqual(current)
    expect(JSON.parse(networkGateItemCommand(current, current.items[0]!)[2]!)).toMatchObject({ version: 3, dataPin: base.dataPin })
    expect(() => parseNetworkGateManifest({ ...current, dataPin: 'd'.repeat(64) })).toThrow('frozen digest')
    expect(() => parseNetworkGateManifest({ ...old, dataPin: base.dataPin })).toThrow('fields')
    expect(parseNetworkGateManifest(old)).toEqual(old)
  })

  it('accepts canonical payload order and rejects changed or duplicated coverage', () => {
    const frozen = manifest(); const item = frozen.items[0]!
    const coverage = { manifest: frozen, grantId: frozen.id, items: [{ deliveryId: item.deliveryId, eventId: item.eventId, key: item.key, grantId: 'synthetic-once-grant', data: { revision: 1, subject: 'One' } }] }
    expect(parseNetworkGateCoverage(coverage)).toEqual(coverage)
    expect(() => parseNetworkGateCoverage({ ...coverage, items: [{ ...coverage.items[0], data: { revision: 2, subject: 'One' } }] })).toThrow('not covered')
    expect(() => parseNetworkGateCoverage({ ...coverage, items: [...coverage.items, ...coverage.items] })).toThrow('Duplicate')
    expect(() => parseNetworkGateManifest({ ...frozen, items: [item, item] })).toThrow('Duplicate')
    expect(() => parseNetworkGateManifest({ ...frozen, workflowId: randomUUID() })).toThrow('fields')
  })
})

/** `status` decides each input by its manifest index, as the owner would at the identity provider. */
function runtimeFixture(status: (index: number) => string = () => 'pending', consume: (grants: { key: string, id: string }[]) => Promise<unknown> = async () => true, excludes = false) {
  const calls: string[] = []
  const f = networkFixture({ gate: async (value, _signal, scope) => {
    scope.assertCurrent()
    const body = value as { operation: string, manifest: NetworkGateManifest, grants?: { key: string, id: string }[] }
    f.engine.gates.authorizeService(scope, body.manifest, body.operation, body.grants)
    calls.push(body.operation)
    if (body.operation === 'create') return { id: body.manifest.id, url: 'https://identity.example.invalid/decision', grants: body.manifest.items.map(item => ({ key: item.deliveryId, id: `synthetic-once-grant-${item.deliveryId}` })) }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, status(body.manifest.items.findIndex(item => item.deliveryId === grant.key))]))
    if (body.operation === 'consume') return consume(body.grants!)
    if (body.operation === 'assertActive') return true
    throw new Error('Unexpected synthetic gate operation')
  } })
  const source = f.pod('Source', { takes: [], gives: ['test.input', 'test.other'], summary: 'Source' }, async () => {})
  const consumer = f.pod('Gated consumer', { takes: ['test.approved', 'test.other'], gives: [], summary: 'Consumer' }, async () => {})
  const independent = f.pod('Independent consumer', { takes: ['test.input'], gives: [], summary: 'Independent' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[consumer, independent].map(podId => ({ podId, source: null, serialCase: false }))], ['test.input', 'test.other', 'test.approved'], [{ key: 'review', kind: 'approve', title: 'Review exact input', takes: 'test.input', gives: 'test.approved', excluded: excludes ? 'test.other' : null }])
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const settle = async () => { await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0) }
  const due = () => f.store.db.prepare('UPDATE network_gate_controls SET next_poll_at=0').run()
  const emit = async (...channels: string[]) => {
    const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
    await f.engine.invocations.finish(authority, 'completed', 'Synthetic source', null, [], channels.map((channel, index) => ({ channel, key: `item-${index}`, sourceItemId: `item-${index}`, sourceVersion: 'v1', payload: { subject: `Synthetic ${index}` } })))
  }
  return { ...f, source, consumer, independent, id, calls, settle, due, emit }
}

it.each([false, true])('runs a stored historical v2 grant only while its data/configuration authority remains empty (changed=%s)', async (changed) => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  const definition = parseNetworkDefinition(JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string))
  f.engine.gates.prepare(definition, f.consumer)
  const current = JSON.parse(f.store.db.prepare('SELECT manifest FROM network_gate_tasks').get()!.manifest as string) as NetworkGateManifest
  const { dataPin: _dataPin, digest: _digest, actionHash: _actionHash, ...previous } = current
  const base = { ...previous, version: 2 as const }
  const action = { ...base, actionHash: networkGateActionHash(base) }
  const historical = parseNetworkGateManifest({ ...action, digest: networkGateDigest(action) })
  const body = canonicalNetworkJson(historical)
  f.store.db.prepare('UPDATE network_gate_tasks SET manifest=?,manifest_hash=? WHERE id=?').run(body, digest(body), historical.id)
  f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create'])
  if (changed) {
    const binding = f.store.db.prepare('SELECT definition_id FROM network_members WHERE pod_id=?').get(f.consumer)!
    f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,\'region\',\'public\',?)').run(binding.definition_id!, JSON.stringify('new configuration'))
  }
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks WHERE id=?').get(historical.id)!.state).toBe(changed ? 'superseded' : 'approved')
  expect(f.started.includes(f.consumer)).toBe(!changed)
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(changed ? 0 : 1)
})

it('keeps gated inputs pending while other consumers and ungated inputs of the same Pod continue', async () => {
  const f = runtimeFixture()
  await f.emit('test.input', 'test.other')
  f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create'])
  expect(f.started).toContain(f.independent)
  expect(f.started).not.toContain(f.consumer)
  f.engine.tick(); await f.settle()
  expect(f.started).toContain(f.consumer)
  const states = f.store.db.prepare(`SELECT event.channel,delivery.state FROM network_deliveries delivery JOIN network_events event ON event.id=delivery.event_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? ORDER BY event.channel`).all(f.consumer)
  expect(states).toEqual([{ channel: 'test.input', state: 'pending' }, { channel: 'test.other', state: 'done' }])
  expect(f.store.db.prepare('SELECT execution_kind FROM network_invocations WHERE pod_id=? ORDER BY rowid').all(f.consumer)).toEqual([{ execution_kind: 'gate_maintenance' }, { execution_kind: 'script' }])
})

it('consumes once before release and verifies the consumed grant before the script starts', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'status', 'consume'])
  expect(f.started).not.toContain(f.consumer)
  f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'status', 'consume', 'assertActive'])
  expect(f.started.filter(id => id === f.consumer)).toHaveLength(1)
  f.engine.tick(); await f.settle()
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(1)
})

it.each(['denied', 'expired'])('does not release an owner decision with outcome %s', async (status) => {
  const f = runtimeFixture(() => status)
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'status'])
  expect(f.started).not.toContain(f.consumer)
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe(status)
  expect(f.store.db.prepare('SELECT outcome FROM network_gate_items').get()!.outcome).toBe(status)
})

it('holds an uncertain consume without repeating it and lets unrelated consumers finish', async () => {
  const f = runtimeFixture(() => 'approved', async () => { throw new Error('Synthetic lost consume reply') })
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'status', 'consume'])
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('unknown')
  expect(f.started).not.toContain(f.consumer)
  expect(f.started).toContain(f.independent)
})

it('never releases a frozen approval after the consumer permissions change', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.store.db.prepare('UPDATE pods SET revision=revision+1 WHERE id=?').run(f.consumer)
  f.due(); f.engine.tick(); await f.settle()
  // Until the consumer is validated for its new permissions, admission stops before any status poll or release.
  expect(f.calls).toEqual(['create'])
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').all().map(row => row.state)).toEqual(['pending'])
  expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'instance-attention\'').get()!.body).toContain('needs validation')
  expect(f.started).not.toContain(f.consumer)
})

it('invalidates a frozen v3 approval after configuration changes without releasing work', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  const original = JSON.parse(f.store.db.prepare('SELECT manifest FROM network_gate_tasks').get()!.manifest as string)
  expect(original.version).toBe(3)
  const binding = f.store.db.prepare('SELECT definition_id FROM network_members WHERE pod_id=?').get(f.consumer)!
  f.store.db.prepare('INSERT INTO definition_config VALUES(?,1,\'region\',\'public\',?)').run(binding.definition_id!, JSON.stringify('changed region'))
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'create'])
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks ORDER BY created_at,rowid').all().map(row => row.state)).toEqual(['superseded', 'pending'])
  expect(f.started).not.toContain(f.consumer)
})

it('releases only the approved inputs of a batch and consumes only their grants', async () => {
  const consumed: string[] = []
  const f = runtimeFixture(index => index === 0 ? 'denied' : 'approved', async (grants) => { consumed.push(...grants.map(grant => grant.key)); return true })
  await f.emit('test.input', 'test.input')
  f.engine.tick(); await f.settle()
  const task = f.engine.view().gates![0]!
  expect(task.items).toHaveLength(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_gate_item_grants WHERE task_id=?').get(task.id)!.count).toBe(2)
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  expect(consumed).toEqual([task.items[1]!.deliveryId])
  expect(f.store.db.prepare('SELECT delivery_id,outcome FROM network_gate_items WHERE task_id=? ORDER BY outcome').all(task.id)).toEqual([{ delivery_id: task.items[0]!.deliveryId, outcome: 'denied' }, { delivery_id: task.items[1]!.deliveryId, outcome: 'released' }])
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)!.state).toBe('discarded')
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[1]!.deliveryId)!.state).toBe('done')
  expect(f.started.filter(id => id === f.consumer)).toHaveLength(1)
  expect(f.calls.filter(operation => operation === 'assertActive')).toHaveLength(1)
})

it('collects inputs answered one after another into one approval after a quiet moment', async () => {
  const f = runtimeFixture()
  f.engine.gates.collect = { quietMs: gateLimits.collectQuietMs, maxMs: gateLimits.collectMaxMs }
  const tasks = () => f.store.db.prepare('SELECT manifest FROM network_gate_tasks').all().map(row => (JSON.parse(row.manifest as string) as NetworkGateManifest).items.length)
  // Only the gated consumer's inputs age; the independent consumer receives copies of the same events.
  const age = (ms: number, which: 'all' | 'oldest') => f.store.db.prepare(`UPDATE network_deliveries SET accepted_at=accepted_at-? WHERE id IN (SELECT delivery.id FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? ORDER BY delivery.accepted_at,delivery.id LIMIT ?)`).run(ms, f.consumer, which === 'all' ? -1 : 1)
  await f.emit('test.input', 'test.input')
  // One input answered a minute ago, the other just now: still collecting, nothing reaches the identity provider.
  age(60000, 'oldest')
  f.engine.tick(); await f.settle()
  expect(tasks()).toEqual([])
  expect(f.calls).toEqual([])
  age(gateLimits.collectQuietMs, 'all')
  f.engine.tick(); await f.settle()
  expect(tasks()).toEqual([2])
  expect(f.calls).toEqual(['create'])
})

it('stops collecting ten minutes after the oldest input even while new ones keep arriving', async () => {
  const f = runtimeFixture()
  f.engine.gates.collect = { quietMs: gateLimits.collectQuietMs, maxMs: gateLimits.collectMaxMs }
  await f.emit('test.input', 'test.input')
  f.store.db.prepare('UPDATE network_deliveries SET accepted_at=accepted_at-? WHERE id=(SELECT delivery.id FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? ORDER BY delivery.accepted_at,delivery.id LIMIT 1)').run(gateLimits.collectMaxMs, f.consumer)
  f.engine.tick(); await f.settle()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_gate_tasks').get()!.count).toBe(1)
})

it('keeps the whole batch waiting while any input is undecided', async () => {
  const f = runtimeFixture(index => index === 0 ? 'approved' : 'pending')
  await f.emit('test.input', 'test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls).toEqual(['create', 'status'])
  expect(f.engine.view().gates![0]!.state).toBe('pending')
  expect(f.started).not.toContain(f.consumer)
})

it('refuses service calls that name a grant the task did not record', async () => {
  const f = runtimeFixture()
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  const task = f.store.db.prepare('SELECT manifest FROM network_gate_tasks').get()!
  const manifest = JSON.parse(task.manifest as string) as NetworkGateManifest
  const scope = { podId: f.consumer, runId: randomUUID() }
  expect(() => f.engine.gates.authorizeService(scope as never, manifest, 'status', [{ key: manifest.items[0]!.deliveryId, id: 'foreign-grant' }])).toThrow('grant identity differs')
  expect(() => f.engine.gates.authorizeService(scope as never, manifest, 'consume', [])).toThrow('grant identity differs')
})

it('allows explicit disposal of a stopped uncertain grant without claiming consumption failed', async () => {
  const f = runtimeFixture(() => 'approved', async () => { throw new Error('Synthetic lost consume reply') })
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const task = f.engine.view().gates![0]!
  f.engine.execute({ type: 'gateDiscard', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic owner reviewed the uncertain grant and discards these inputs' })
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks WHERE id=?').get(task.id)!.state).toBe('superseded')
  expect(f.engine.view().gates ?? []).toEqual([])
  expect(f.store.db.prepare('SELECT state FROM network_gate_task_attempts ORDER BY attempt DESC LIMIT 1').get()!.state).toBe('unknown')
  expect(f.store.db.prepare(`SELECT body FROM network_trace_events WHERE kind='gate-owner-discard'`).get()!.body).toContain('unknown-retained')
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)!.state).toBe('discarded')
})

it('fences a real SIGKILL after once-consumption and resumes only unrelated inputs after process inspection', async () => {
  const f = runtimeFixture()
  await f.emit('test.input', 'test.other')
  const marker = join(f.store.root, 'synthetic-once-consumed.txt')
  const loader = createRequire(import.meta.url).resolve('tsx')
  const modules = Object.fromEntries(['storage/database', 'runs/store', 'resources/registry', 'scheduling/network-invocations', 'scheduling/network-gates'].map(path => [path, resolve(`src/worker/${path}.ts`)]))
  const child = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', `
    import { PodDatabase } from ${JSON.stringify(modules['storage/database'])};
    import { RunStore } from ${JSON.stringify(modules['runs/store'])};
    import { ResourceRegistry } from ${JSON.stringify(modules['resources/registry'])};
    import { NetworkInvocations } from ${JSON.stringify(modules['scheduling/network-invocations'])};
    import { NetworkGates } from ${JSON.stringify(modules['scheduling/network-gates'])};
    import { writeFileSync } from 'node:fs';
    const store = new PodDatabase(${JSON.stringify(f.store.root)});
    const invocations = new NetworkInvocations(store,new RunStore(store),'/unused');
    const gates = new NetworkGates(store,invocations,new ResourceRegistry(store,()=>{}));
    gates.collect={quietMs:0,maxMs:0};
    invocations.gates=gates;
    const definition=JSON.parse(store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(${JSON.stringify(f.id)}).contract);
    gates.prepare(definition,${JSON.stringify(f.consumer)});
    let step=gates.reserve(definition,${JSON.stringify(f.consumer)},'event');
    await gates.round(step,async(body)=>({id:body.manifest.id,url:'https://identity.example.invalid/decision',grants:body.manifest.items.map(item=>({key:item.deliveryId,id:'synthetic-crash-'+item.deliveryId}))}),new AbortController().signal);
    store.db.prepare('UPDATE network_gate_controls SET next_poll_at=0').run();
    step=gates.reserve(definition,${JSON.stringify(f.consumer)},'event');
    await gates.round(step,async(body)=>{
      if(body.operation==='status')return Object.fromEntries(body.grants.map(grant=>[grant.key,'approved']));
      if(body.operation!=='consume')throw new Error('Unexpected synthetic grant operation');
      writeFileSync(${JSON.stringify(marker)},'once-consumed');
      process.kill(process.pid,'SIGKILL');
    },new AbortController().signal);
  `], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 20000 })
  expect(child.signal, child.stderr).toBe('SIGKILL')
  expect(readFileSync(marker, 'utf8')).toBe('once-consumed')
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('consuming')
  const dispatcher = new RunDispatcher(f.store, f.resources, { helper: '/unused', environment: {} } as AgentRuntime, { gate: async () => { throw new Error('An interrupted once-consume must never be repeated') } })
  const engine = new NetworkEngine(f.store, dispatcher, f.resources, '/unused', () => f.owner)
  engine.gates.collect = { quietMs: 0, maxMs: 0 }
  try {
    expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('unknown')
    await engine.reconcileStartup()
    engine.tick()
    await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
    expect(readFileSync(marker, 'utf8')).toBe('once-consumed')
    expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('unknown')
    expect(f.store.db.prepare(`SELECT state FROM network_gate_task_attempts ORDER BY attempt DESC LIMIT 1`).get()!.state).toBe('unknown')
    const states = f.store.db.prepare(`SELECT event.channel,delivery.state FROM network_deliveries delivery JOIN network_events event ON event.id=delivery.event_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? ORDER BY event.channel`).all(f.consumer)
    expect(states).toEqual([{ channel: 'test.input', state: 'pending' }, { channel: 'test.other', state: 'done' }])
    expect(f.started).toContain(f.consumer)
    expect(f.started).toContain(f.independent)
  }
  finally { await engine.stop(); await dispatcher.stop() }
})

it('retries failed status reads without losing held inputs and bounds their durable history', async () => {
  const f = runtimeFixture(() => { throw new Error('Synthetic offline status read') })
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  for (let index = 0; index < 16; index++) { f.due(); f.engine.tick(); await f.settle() }
  const task = f.engine.view().gates![0]!
  expect(task).toMatchObject({ state: 'pending', error: 'Synthetic offline status read' })
  expect(f.calls.filter(operation => operation === 'status')).toHaveLength(16)
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(0)
  expect(f.store.db.prepare('SELECT poll_count,pruned_status_count FROM network_gate_controls').get()).toEqual({ poll_count: 16, pruned_status_count: 12 })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_gate_task_attempts').get()!.count).toBe(5)
  expect(f.store.db.prepare(`SELECT count(*) AS count FROM network_invocations WHERE pod_id=?`).get(f.consumer)!.count).toBe(5)
  expect(f.dispatcher.runs.list(f.consumer)).toEqual([])
  expect(task.items[0]!.outcome).toBe('held')
})

it('lets approved sibling cases continue after one input fails without consuming the batch again', async () => {
  const f = runtimeFixture(() => 'approved')
  f.behaviours.set(f.consumer, async (items, request) => {
    const coverage = await request('network.gateCoverage', {}) as { gate: string, items: unknown[] }[]
    expect(Object.keys(coverage[0]!)).toEqual(['gate', 'items'])
    expect(coverage[0]!.items).toHaveLength(1)
    if (items[0]!.key === 'item-0') throw new Error('Synthetic data failure in the first case')
  })
  await f.emit('test.input', 'test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  const outcomes = f.store.db.prepare(`SELECT event.item_key,delivery.state FROM network_deliveries delivery JOIN network_events event ON event.id=delivery.event_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? ORDER BY event.item_key`).all(f.consumer)
  expect(outcomes).toEqual([{ item_key: 'item-0', state: 'blocked' }, { item_key: 'item-1', state: 'done' }])
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(1)
  expect(f.engine.view().gates![0]!.state).toBe('approved')
})

it('requires explicit owner review and a fresh grant after an unclaimed approval becomes obsolete', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const original = f.engine.view().gates![0]!
  vi.spyOn(Date, 'now').mockReturnValue(original.expiresAt + 1)
  f.engine.tick(); await f.settle()
  const obsolete = f.engine.view().gates![0]!
  expect(obsolete.state).toBe('superseded')
  expect(f.started).not.toContain(f.consumer)
  f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: obsolete.id, generation: obsolete.generation, evidence: 'Synthetic owner reviews the exact obsolete input and requests a new approval' })
  f.engine.tick(); await f.settle()
  expect(f.engine.view().gates!.find(gate => gate.state === 'pending')!.id).not.toBe(original.id)
  expect(f.calls.filter(operation => operation === 'create')).toHaveLength(2)
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(2)
  expect(f.started.filter(id => id === f.consumer)).toHaveLength(1)
})

it('preserves restored gate uncertainty and allows owner disposal without reusing authority', async () => {
  const f = runtimeFixture()
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  restoreNetworkStorage(f.store.db)
  const task = f.engine.view().gates![0]!
  expect(task.state).toBe('unknown')
  expect(task.items[0]!.outcome).toBe('unknown')
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)!.state).toBe('unknown')
  expect(() => f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Premature restored approval' })).toThrow('Restored network requires a reviewed baseline')
  f.engine.execute({ type: 'gateDiscard', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic owner discards the restored uncertain work after review' })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)!.state).toBe('discarded')
  expect(f.calls).toEqual(['create'])
  expect(f.store.db.prepare('SELECT grant_id FROM network_gate_item_grants').get()!.grant_id).toContain('synthetic-once-grant')
})

it('preserves an uncertain consume and requires explicit owner review plus a new grant before any input resumes', async () => {
  let consumes = 0
  const f = runtimeFixture(() => 'approved', async () => { if (++consumes === 1) throw new Error('Synthetic uncertain consume'); return true })
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const old = f.engine.view().gates![0]!
  f.due(); f.engine.tick(); await f.settle()
  expect(consumes).toBe(1)
  f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: old.id, generation: old.generation, evidence: 'Synthetic owner explicitly requests independent fresh approval and retains the prior unknown consume' })
  f.engine.tick(); await f.settle()
  const fresh = f.engine.view().gates!.find(gate => gate.state === 'pending')!
  expect(fresh.id).not.toBe(old.id)
  expect(f.store.db.prepare('SELECT resolution FROM network_gate_controls WHERE task_id=?').get(old.id)!.resolution).toContain('unknown-retained')
  f.due(); f.engine.tick(); await f.settle()
  f.engine.tick(); await f.settle()
  expect(consumes).toBe(2)
  expect(f.started.filter(id => id === f.consumer)).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM network_gate_task_attempts WHERE task_id=? ORDER BY attempt DESC LIMIT 1').get(old.id)!.state).toBe('unknown')
})

it('blocks gated transient failures and refuses retry or fresh approval without stopped-process evidence', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic prelaunch failure', 'Permission service temporarily unavailable', [], [], true)
  const delivery = f.store.db.prepare('SELECT id,state,generation FROM network_deliveries WHERE run_id=?').get(authority.runId)!
  expect(delivery.state).toBe('blocked')
  expect(f.store.db.prepare('SELECT retry_at FROM network_invocation_controls WHERE run_id=?').get(authority.runId)!.retry_at).toBeNull()
  await expect(f.engine.recover({ type: 'retry', id: f.id, revision: 1, runId: authority.runId, generation: 1 })).rejects.toThrow('fresh reviewed gate batch')
  expect(f.store.db.prepare('SELECT state,generation FROM network_deliveries WHERE id=?').get(delivery.id!)).toEqual({ state: 'blocked', generation: delivery.generation })
  f.store.db.prepare('UPDATE network_invocation_controls SET stopped_receipt=NULL WHERE run_id=?').run(authority.runId)
  const task = f.engine.view().gates![0]!
  expect(() => f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic premature input review' })).toThrow('Inspect the stopped input')
})

it('refuses fresh approval for a previously applied external action and retains its receipts', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  const item = f.engine.invocations.input(authority).items[0]!
  const key = networkGatePayloadHash({ action: 'synthetic-applied-action' })
  f.store.transaction(() => {
    f.store.db.prepare(`INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,'confirmed_applied',1,?)`).run(key, authority.runId, item.caseId, 'a'.repeat(64), 'b'.repeat(64), f.id)
    f.store.db.prepare(`INSERT INTO network_effect_receipts VALUES(?,1,1,'confirmed_applied','{"synthetic":true}',1)`).run(key)
  })
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic failed after an applied action', 'Synthetic fixture only; no provider action occurred', [], [])
  const task = f.engine.view().gates![0]!
  expect(() => f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic unsafe repeated action request' })).toThrow('Applied or uncertain external actions')
  expect(f.store.db.prepare('SELECT state FROM network_effect_attempts').get()!.state).toBe('confirmed_applied')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_effect_receipts').get()!.count).toBe(1)
})

it('keeps a not-started gate operation repeatable at boot and ignores stale failure callbacks', async () => {
  const f = runtimeFixture()
  await f.emit('test.input')
  const definition = JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string)
  f.engine.gates.prepare(definition, f.consumer)
  const step = f.engine.gates.reserve(definition, f.consumer, 'event')!
  fenceNetworkBoot(f.store)
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('preparing')
  expect(f.store.db.prepare('SELECT state FROM network_gate_task_attempts').get()!.state).toBe('blocked')
  await f.engine.gates.failStep(step, new Error('Synthetic late failure from the fenced old attempt'))
  expect(f.store.db.prepare('SELECT state FROM network_gate_tasks').get()!.state).toBe('preparing')
  expect(f.calls).toEqual([])
})

it.each(['status', 'consume'])('exposes restored failed %s maintenance for inspection before owner disposal', async (operation) => {
  const f = runtimeFixture(() => { if (operation === 'status') throw new Error('Synthetic offline status'); return 'approved' }, async () => { throw new Error('Synthetic uncertain consume') })
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  restoreNetworkStorage(f.store.db)
  const task = f.engine.view().gates![0]!
  expect(task.state).toBe('unknown')
  const receipt = f.store.db.prepare('SELECT receipt FROM network_gate_items WHERE task_id=?').get(task.id)!.receipt as string
  expect(() => f.engine.execute({ type: 'gateDiscard', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Premature restored disposal' })).toThrow('verified process cleanup')
  const failure = f.engine.view().networks[0]!.health.lastFailure!
  expect(failure).not.toBeNull()
  const oldResolution = JSON.parse(f.store.db.prepare('SELECT resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(failure.runId)!.resolved_receipt as string)
  await f.engine.recover({ type: 'inspect', id: f.id, revision: 1, runId: failure.runId, generation: failure.generation })
  expect(JSON.parse(f.store.db.prepare('SELECT resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(failure.runId)!.resolved_receipt as string).priorResolution).toEqual(oldResolution)
  expect(f.engine.view().networks[0]!.health.lastFailure).toBeNull()
  await expect(f.engine.recover({ type: 'discardFailure', id: f.id, revision: 1, runId: failure.runId, generation: failure.generation, evidence: 'Synthetic generic maintenance discard is refused' })).rejects.toThrow('resolved through its gate task')
  expect(JSON.parse(f.store.db.prepare('SELECT resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(failure.runId)!.resolved_receipt as string).priorResolution).toEqual(oldResolution)
  f.engine.execute({ type: 'gateDiscard', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic owner disposal after inspecting restored maintenance' })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)!.state).toBe('discarded')
  const retained = JSON.parse(f.store.db.prepare('SELECT receipt FROM network_gate_items WHERE task_id=?').get(task.id)!.receipt as string)
  expect(retained.priorReceipt).toEqual(JSON.parse(receipt))
  expect(f.calls.filter(call => call === 'consume')).toHaveLength(operation === 'consume' ? 1 : 0)
})

it('keeps gated and ungated channels in separate batches even for the same source case', async () => {
  const f = runtimeFixture(() => 'approved')
  const source = f.engine.invocations.reserve(f.id, f.source, f.resources.epoch(f.source), 'manual')!
  await f.engine.invocations.finish(source, 'completed', 'Synthetic shared case', null, [], ['test.input', 'test.other'].map(channel => ({ channel, key: 'shared', sourceItemId: 'shared', sourceVersion: 'v1', payload: { subject: 'Shared synthetic case' } })))
  const definition = JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string)
  f.engine.gates.prepare(definition, f.consumer)
  f.dispatcher.startGate(f.engine.gates, f.engine.gates.reserve(definition, f.consumer, 'event')!)
  await f.settle()
  f.due()
  f.dispatcher.startGate(f.engine.gates, f.engine.gates.reserve(definition, f.consumer, 'event')!)
  await f.settle()
  const failed = new Map<string, { runId: string, claimToken: string }>()
  for (let index = 0; index < 2; index++) {
    const invocation = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
    const channels = f.store.db.prepare('SELECT subscription.channel FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE delivery.run_id=?').all(invocation.runId)
    expect(channels).toHaveLength(1)
    if (!index) expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries delivery JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id WHERE subscription.pod_id=? AND delivery.state=\'pending\' AND delivery.run_id IS NULL').get(f.consumer)!.count).toBe(1)
    failed.set(channels[0]!.channel as string, invocation)
    await f.engine.invocations.finish(invocation, 'failed', 'Synthetic isolated input failure', 'Synthetic invalid input', [], [])
  }
  expect([...failed.keys()].sort()).toEqual(['test.input', 'test.other'])
  const task = f.engine.view().gates![0]!
  f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic fresh approval after isolated gated failure' })
  await f.engine.recover({ type: 'retry', id: f.id, revision: 1, runId: failed.get('test.other')!.runId, generation: 1 })
  expect(f.store.db.prepare('SELECT state,run_id FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)).toEqual({ state: 'pending', run_id: null })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(failed.get('test.other')!.runId)!.state).toBe('retry_wait')
})

it('prioritizes restored uncertain maintenance inspection over a newer unrelated script failure', async () => {
  const f = runtimeFixture(() => 'approved', async () => { throw new Error('Synthetic lost consume response') })
  await f.emit('test.input')
  const definition = JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string)
  f.engine.gates.prepare(definition, f.consumer)
  f.dispatcher.startGate(f.engine.gates, f.engine.gates.reserve(definition, f.consumer, 'event')!); await f.settle()
  f.due()
  f.dispatcher.startGate(f.engine.gates, f.engine.gates.reserve(definition, f.consumer, 'event')!); await f.settle()
  const unrelated = f.engine.invocations.reserve(f.id, f.independent, f.resources.epoch(f.independent), 'event')!
  await f.engine.invocations.finish(unrelated, 'failed', 'Synthetic unrelated failure', 'Synthetic invalid input', [], [])
  restoreNetworkStorage(f.store.db)
  const failure = f.engine.view().networks[0]!.health.lastFailure!
  expect(failure.runId).not.toBe(unrelated.runId)
  await f.engine.recover({ type: 'inspect', id: f.id, revision: 1, runId: failure.runId, generation: failure.generation })
  expect(f.engine.view().networks[0]!.health.lastFailure!.runId).toBe(unrelated.runId)
  const task = f.engine.view().gates![0]!
  f.engine.execute({ type: 'gateDiscard', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic independent disposal after current maintenance inspection' })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(unrelated.runId)!.state).toBe('blocked')
  expect(f.calls.filter(call => call === 'consume')).toHaveLength(1)
})

it('requires confirmed non-application and fresh owner approval before an uncertain gated input resumes', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  const item = f.engine.invocations.input(authority).items[0]!
  const key = networkGatePayloadHash({ action: 'synthetic-uncertain-action' })
  f.store.transaction(() => {
    f.store.db.prepare(`INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,'unknown',1,?)`).run(key, authority.runId, item.caseId, 'a'.repeat(64), 'b'.repeat(64), f.id)
    f.store.db.prepare(`INSERT INTO network_effect_receipts VALUES(?,1,1,'unknown','{"synthetic":true,"noProviderAction":true}',1)`).run(key)
  })
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic uncertain effect', 'No real provider action occurred', [], [])
  const task = f.engine.view().gates![0]!
  const command = { type: 'gateReview' as const, id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic independent fresh grant review after explicit effect reconciliation' }
  expect(() => f.engine.execute(command)).toThrow('Applied or uncertain external actions')
  const generation = Number(f.store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(authority.runId)!.generation)
  await f.engine.recover({ type: 'reconcileEffect', id: f.id, revision: 1, runId: authority.runId, generation, key, attempt: 1, sequence: 1, outcome: 'confirmed_not_applied', evidence: 'Synthetic owner verifies no external action occurred; test-only receipt' })
  f.engine.execute(command)
  expect(f.store.db.prepare('SELECT state,run_id FROM network_deliveries WHERE id=?').get(task.items[0]!.deliveryId)).toEqual({ state: 'pending', run_id: null })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_effect_receipts WHERE logical_action_key=?').get(key)!.count).toBe(2)
  f.engine.tick(); await f.settle()
  expect(f.calls.filter(operation => operation === 'create')).toHaveLength(2)
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(1)
  expect(f.started).not.toContain(f.consumer)
})

// With a deliveryId the effect records an intent naming that input first, as the archive port does.
function syntheticUnknownEffect(f: ReturnType<typeof runtimeFixture>, runId: string, caseId: string, action: string, deliveryId?: string) {
  const key = networkGatePayloadHash({ action })
  f.store.transaction(() => {
    f.store.db.prepare(`INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,'unknown',1,?)`).run(key, runId, caseId, 'a'.repeat(64), 'b'.repeat(64), f.id)
    if (deliveryId) f.store.db.prepare(`INSERT INTO network_effect_receipts VALUES(?,1,1,'intent',?,1)`).run(key, JSON.stringify({ deliveryId, synthetic: true }))
    f.store.db.prepare(`INSERT INTO network_effect_receipts VALUES(?,1,?,'unknown','{"synthetic":true,"noProviderAction":true}',1)`).run(key, deliveryId ? 2 : 1)
  })
  return key
}

it('asks again for the safe inputs of a batch and keeps only the uncertain one back for review', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input', 'test.input', 'test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  const item = f.engine.invocations.input(authority).items[0]!
  syntheticUnknownEffect(f, authority.runId, item.caseId, 'synthetic-uncertain-action')
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic uncertain effect', 'No real provider action occurred', [], [])
  const uncertain = f.store.db.prepare('SELECT id FROM network_deliveries WHERE run_id=?').get(authority.runId)!.id as string
  const task = f.engine.view().gates![0]!
  expect(task.items).toHaveLength(3)

  f.engine.execute({ type: 'gateReview', id: f.id, revision: 1, taskId: task.id, generation: task.generation, evidence: 'Synthetic owner asks again after an authority change' })

  const states = Object.fromEntries(task.items.map(entry => [entry.deliveryId, f.store.db.prepare('SELECT state FROM network_deliveries WHERE id=?').get(entry.deliveryId)!.state]))
  expect(states).toEqual(Object.fromEntries(task.items.map(entry => [entry.deliveryId, entry.deliveryId === uncertain ? 'unknown' : 'pending'])))
  const superseded = f.engine.view().gates!.find(gate => gate.id === task.id)!
  expect(superseded.state).toBe('superseded')
  expect(superseded.items.find(entry => entry.deliveryId === uncertain)!.outcome).toBe('released')
  expect(JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'gate-owner-fresh-approval\'').get()!.body as string)).toMatchObject({ resumed: 2, held: 1 })
  expect(f.store.db.prepare('SELECT state FROM network_effect_attempts').get()!.state).toBe('unknown')
})

async function failedWithEffect(bound: boolean, outcome: 'confirmed_applied' | 'confirmed_not_applied' = 'confirmed_applied') {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  const item = f.engine.invocations.input(authority).items[0]!
  const deliveryId = f.store.db.prepare('SELECT id FROM network_deliveries WHERE run_id=?').get(authority.runId)!.id as string
  const key = syntheticUnknownEffect(f, authority.runId, item.caseId, 'synthetic-uncertain-action', bound ? deliveryId : undefined)
  await f.engine.invocations.finish(authority, 'failed', 'Synthetic uncertain effect', 'No real provider action occurred', [], [])
  const generation = () => Number(f.store.db.prepare('SELECT generation FROM network_invocations WHERE run_id=?').get(authority.runId)!.generation)
  const reconcile = () => f.engine.recover({ type: 'reconcileEffect', id: f.id, revision: 1, runId: authority.runId, generation: generation(), key, attempt: 1, sequence: bound ? 2 : 1, outcome, evidence: 'Synthetic owner-confirmed provider evidence' })
  const discard = () => f.engine.recover({ type: 'discardFailure', id: f.id, revision: 1, runId: authority.runId, generation: generation(), evidence: 'Provider shows the synthetic action applied' })
  return { ...f, authority, reconcile, discard }
}

it('closes a failed run only after its unknown effect was reconciled', async () => {
  const f = await failedWithEffect(true)
  await expect(f.discard()).rejects.toThrow('require reconciliation before discarding')
  await f.reconcile()

  await f.discard()

  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(f.authority.runId)!.state).toBe('discarded')
  expect(JSON.parse(f.store.db.prepare('SELECT resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(f.authority.runId)!.resolved_receipt as string).evidence).toBe('Provider shows the synthetic action applied')
})

it('blocks archival for pending approvals and preserves completed approval history through archive restore', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  const definition = parseNetworkDefinition(JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(f.id)!.contract as string))
  f.engine.gates.prepare(definition, f.consumer)
  f.engine.execute({ type: 'pause', id: f.id, revision: 1 })
  const review = f.engine.execute({ type: 'archivePreview', id: f.id, revision: 1 }).archiveReview!
  expect(review.issues).toContain('Resolve pending or uncertain approvals before changing the composition')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id: f.id, revision: 1, expectedFingerprint: review.fingerprint })).toThrow('Resolve pending')
  f.engine.execute({ type: 'activate', id: f.id, revision: 1 })
  await vi.waitFor(async () => {
    f.due(); await f.engine.tick(); await f.settle()
    expect(f.store.db.prepare('SELECT count(*) AS n FROM network_deliveries WHERE state!=\'done\'').get()!.n).toBe(0)
  })
  f.engine.execute({ type: 'pause', id: f.id, revision: 1 })
  const settled = f.engine.execute({ type: 'archivePreview', id: f.id, revision: 1 }).archiveReview!
  expect(settled.issues).toEqual([])
  f.engine.execute({ type: 'archiveNetwork', id: f.id, revision: 1, expectedFingerprint: settled.fingerprint })
  const before = f.store.db.prepare('SELECT id,state FROM network_gate_tasks').all()
  const itemsBefore = f.store.db.prepare('SELECT * FROM network_gate_items').all()
  const controlsBefore = f.store.db.prepare('SELECT * FROM network_gate_controls').all()
  const { restoreNetworkStorage } = await import('../../src/worker/storage/network-restore')
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.store.db.prepare('SELECT id,state FROM network_gate_tasks').all()).toEqual(before)
  expect(f.store.db.prepare('SELECT * FROM network_gate_items').all()).toEqual(itemsBefore)
  expect(f.store.db.prepare('SELECT * FROM network_gate_controls').all()).toEqual(controlsBefore)
  expect(f.engine.view().networks[0]!.decisions).toBe(0)
})

it('maps the approved channel only after the exact retained input receives approval', async () => {
  const f = runtimeFixture(() => 'approved', async () => true, true)
  await f.emit('test.input')
  expect(f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')).toBeNull()
  f.engine.tick(); await f.settle()
  const task = f.engine.view().gates![0]!
  const manifest = JSON.parse(f.store.db.prepare('SELECT manifest FROM network_gate_tasks WHERE id=?').get(task.id)!.manifest as string) as NetworkGateManifest
  expect(manifest.items[0]!.channel).toBe('test.input')
  f.due(); f.engine.tick(); await f.settle()
  const authority = f.engine.invocations.reserve(f.id, f.consumer, f.resources.epoch(f.consumer), 'event')!
  expect(authority).not.toBeNull()
  expect(f.engine.invocations.input(authority).items[0]).toMatchObject({ eventId: manifest.items[0]!.eventId, channel: 'test.approved' })
  await f.engine.invocations.finish(authority, 'completed', 'Synthetic reviewed preview only', null, [manifest.items[0]!.eventId], [])
  expect(f.store.db.prepare('SELECT channel FROM network_events WHERE id=?').get(manifest.items[0]!.eventId)!.channel).toBe('test.input')
})

it('routes a denied input once to the excluded channel and retains its receipt', async () => {
  const f = runtimeFixture(() => 'denied', async () => true, true)
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  const task = f.engine.view().gates![0]!
  f.due(); f.engine.tick(); await f.settle()
  f.due(); f.engine.tick(); await f.settle()
  expect(f.calls.filter(operation => operation === 'consume')).toHaveLength(0)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_events WHERE channel=\'test.other\'').get()!.n).toBe(1)
  expect(f.store.db.prepare('SELECT outcome,receipt FROM network_gate_items WHERE task_id=?').get(task.id)).toMatchObject({ outcome: 'denied', receipt: expect.stringContaining('Owner approval denied') })
  expect(f.engine.view().gates!.find(gate => gate.id === task.id)!.state).toBe('denied')
})

it('upgrades a schema-41 network with approval bindings and keeps its pending batch and open choice decidable', async () => {
  let status = 'pending'; const calls: string[] = []
  const f = networkFixture({ gate: async (value, _signal, scope) => {
    scope.assertCurrent()
    const body = value as { operation: string, manifest: NetworkGateManifest, grants?: { key: string, id: string }[] }
    f.engine.gates.authorizeService(scope, body.manifest, body.operation, body.grants)
    calls.push(body.operation)
    if (body.operation === 'create') return { id: body.manifest.id, url: 'https://identity.example.invalid/decision', grants: body.manifest.items.map(item => ({ key: item.deliveryId, id: `synthetic-once-grant-${item.deliveryId}` })) }
    if (body.operation === 'status') return Object.fromEntries(body.grants!.map(grant => [grant.key, status]))
    return true
  } })
  const source = f.pod('Intake', { takes: [], gives: ['mail.unsure', 'mail.batch'], summary: 'Reads mail' }, async () => {})
  const selected = f.pod('Selected', { takes: ['mail.selected'], gives: [], summary: 'Keeps mail' }, async () => {})
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives approved mail' }, async () => {})
  const routes = [
    { key: 'uncertain-review', title: 'Review uncertain mail', kind: 'choose' as const, takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep', channel: 'mail.selected' }, { key: 'other', title: 'Other', channel: 'mail.selected' }] },
    { key: 'newsletter-approval', title: 'Approve newsletter preview', kind: 'approve' as const, takes: 'mail.batch', gives: 'mail.approved', excluded: null },
  ]
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[selected, archive].map(podId => ({ podId, source: null, serialCase: false }))], ['mail.unsure', 'mail.selected', 'mail.batch', 'mail.approved'], routes)
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const authority = f.engine.invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
  await f.engine.invocations.finish(authority, 'completed', 'Synthetic intake', null, [], ['mail.unsure', 'mail.batch'].map(channel => ({ channel, key: channel, sourceItemId: channel, sourceVersion: 'v1', payload: { subject: channel } })))
  const settle = async () => { await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0) }
  f.engine.tick(); await settle()
  expect(calls).toEqual(['create'])
  const retained = () => ({ tasks: f.store.db.prepare('SELECT * FROM network_gate_tasks').all(), choices: f.store.db.prepare('SELECT * FROM network_choices').all(), traces: f.store.db.prepare('SELECT * FROM network_trace_events').all() })
  const before = retained()

  // Store the definition as the schema-41 build did: format 5 with each approve route duplicated as a gate binding.
  const current = JSON.parse(f.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=?').get(id)!.contract as string)
  const legacy = canonicalNetworkJson({ ...current, formatVersion: 5, gates: [{ key: 'newsletter-approval', title: 'Approve newsletter preview', kind: 'approve', podId: archive, channel: 'mail.batch' }] })
  f.store.db.prepare('UPDATE network_revisions SET contract=?,content_hash=? WHERE network_id=?').run(legacy, digest(legacy), id)
  f.store.db.exec('PRAGMA user_version=41')
  new PodDatabase(f.store.root).close()

  const upgraded = f.store.db.prepare('SELECT contract,content_hash FROM network_revisions WHERE network_id=?').get(id)!
  expect(JSON.parse(upgraded.contract as string)).toEqual({ ...current, formatVersion: 6 })
  expect(upgraded.content_hash).toBe(digest(upgraded.contract as string))
  expect(() => assertNetworkStorage(f.store.db, true)).not.toThrow()
  expect(retained()).toEqual(before)
  const view = f.engine.execute({ type: 'list' })
  expect(view.gates).toMatchObject([{ gate: 'newsletter-approval', podId: archive, state: 'pending' }])
  expect(view.choices).toMatchObject([{ gate: 'uncertain-review', networkId: id, revision: 1 }])

  f.engine.execute({ type: 'choose', id, revision: 1, eventId: view.choices![0]!.eventId, gate: 'uncertain-review', option: 'keep' })
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_events WHERE channel=\'mail.selected\'').get()!.n).toBe(1)
  status = 'approved'
  f.store.db.prepare('UPDATE network_gate_controls SET next_poll_at=0').run(); f.engine.tick(); await settle()
  f.engine.tick(); await settle()
  expect(calls).toEqual(['create', 'status', 'consume', 'assertActive'])
  expect(f.started).toEqual(expect.arrayContaining([selected, archive]))
})

it('offers a batch for grant release only after every approved input settled, once', async () => {
  const f = runtimeFixture(() => 'approved')
  await f.emit('test.input')
  f.engine.tick(); await f.settle()
  expect(f.engine.gates.releasable()).toEqual([])
  f.due(); f.engine.tick(); await f.settle()
  // Released to the consumer but not yet processed: an always grant must stay active for the archive moves.
  expect(f.calls).toContain('consume')
  expect(f.engine.gates.releasable()).toEqual([])
  f.engine.tick(); await f.settle()
  expect(f.started).toContain(f.consumer)
  const [release] = f.engine.gates.releasable()
  const task = f.store.db.prepare('SELECT id FROM network_gate_tasks').get()!
  expect(release).toMatchObject({ taskId: task.id, podId: f.consumer, owner: f.owner, grants: [{ key: release!.manifest.items[0]!.deliveryId, id: expect.stringMatching(/^synthetic-once-grant-/) }] })
  expect(parseNetworkGateReleases(JSON.parse(JSON.stringify([release])))).toEqual([release])
  f.engine.gates.released(release!.taskId)
  f.engine.gates.released(release!.taskId)
  expect(f.engine.gates.releasable()).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_trace_events WHERE kind=\'gate-grants-released\'').get()!.n).toBe(1)
})

it('refuses to upgrade an approval binding that no route expresses', () => {
  const definition = { formatVersion: 2, id: randomUUID(), revision: 1, members: [{ podId: randomUUID(), contract: { takes: ['mail.batch'] } }], gates: [{ key: 'direct', title: 'Direct approval', podId: randomUUID(), channel: 'mail.batch' }] }
  expect(() => upgradeNetworkDefinition(definition)).toThrow('approval gate without its route')
  expect(upgradeNetworkDefinition({ ...definition, gates: [] })).toEqual({ formatVersion: 6, id: definition.id, revision: 1, members: definition.members, routes: [], joins: [], feedback: [] })
})
