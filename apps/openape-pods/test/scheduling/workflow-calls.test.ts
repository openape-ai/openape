// @vitest-environment node
import { networkPublicationTables } from '../../src/worker/central/network-projection'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { closeNetworks, networkFixture } from './network-fixture'
import { RunRetention } from '../../src/worker/data/run-retention'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { discardGateBatch } from '../../src/worker/workflows/gates'
import { WorkflowCalls } from '../../src/worker/workflows/calls'
import { workflowInput, publishWorkflowOutput } from '../../src/worker/workflows/handoff'
import { installExample } from '../../src/worker/runs/examples'
import { PodGroups } from '../../src/worker/workspace/groups'
import type { RunTrigger } from '../../src/worker/runs/store'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })
const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }

async function fixture() {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['input', 'repeat'], summary: 'Invoice source' }, async () => {})
  const caller = f.pod('Caller', { takes: ['input', 'repeat'], gives: ['output', 'terminal'], summary: 'Finite invoice caller' }, async () => {})
  const sink = f.pod('Sink', { takes: ['output', 'terminal'], gives: [], summary: 'Correlated results' }, async () => {})
  const networkId = f.engine.execute({ type: 'create', draft: { name: 'Invoice network', groupId: f.groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: caller, source: null, serialCase: false }, { podId: sink, source: null, serialCase: false }], channels: ['input', 'repeat', 'output', 'terminal'].map(name => ({ name, title: name, schemaVersion: 1, schema: name === 'terminal' ? { type: 'object', properties: { requestId: { type: 'string' }, status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] } }, required: ['requestId', 'status'], additionalProperties: false } : schema })) } }).createdId!
  const legacyPod = f.store.createPod({ name: 'Finite processor' }).id
  const groups = new PodGroups(f.store)
  groups.execute({ type: 'organize', action: 'move', podId: legacyPod, groupId: f.groupId, revision: groups.view().revision })
  installExample(f.store, f.resources, legacyPod, 'deterministic', 'a'.repeat(64))
  const started: { id: string, podId: string, trigger: RunTrigger }[] = []
  const driver = { start: (podId: string, trigger: RunTrigger) => { const run = f.dispatcher.runs.reserve(podId, f.store.getPod(podId).activeScript!, f.resources.epoch(podId), trigger).run; started.push({ id: run.id, podId, trigger }); return run.id }, cancelPod: vi.fn() }
  const workflows = new WorkflowEngine(f.store, driver, { inspect: vi.fn(async () => {}) })
  const workflowId = randomUUID()
  workflows.save({ type: 'save', id: workflowId, revision: 0, name: 'Finite invoice workflow', nodes: [{ podId: legacyPod, after: [], handoff: false }], schedule: null, enabled: false, groupId: f.groupId })
  workflows.pause(workflowId, 1, false)

  workflows.publishRevision(workflowId, 2, { version: 1, inputs: [{ name: 'invoice', version: 1, schema, podId: legacyPod }], outputs: [{ name: 'result', version: 1, schema, podId: legacyPod, legacySchema: 'invoice/v1' }], requiredTerminals: [legacyPod], requiredGates: [] })
  f.store.db.prepare('INSERT INTO workflow_call_permissions VALUES(?,?,?,?,?,?,?,1,1)').run(workflowId, 1, networkId, caller, f.owner.issuer, f.owner.subject, f.groupId)
  const calls = new WorkflowCalls(f.store, f.engine.invocations.events, workflows)
  f.engine.invocations.calls = calls
  f.engine.execute({ type: 'activate', id: networkId, revision: 1 })
  async function invoice(subject: string, channel = 'input') {
    const authority = f.engine.invocations.reserve(networkId, source, f.resources.epoch(source), 'manual')!
    await f.engine.invocations.finish(authority, 'completed', 'Invoice accepted', null, [], [{ channel, key: subject, sourceItemId: subject, sourceVersion: '1', payload: { subject } }])
    const consumer = f.engine.invocations.reserve(networkId, caller, f.resources.epoch(caller), 'manual')!
    const request = { requestId: randomUUID(), workflowId, workflowRevision: 1, inputs: { invoice: { version: 1, data: { subject } } }, routes: { outputs: { result: 'output' }, terminal: 'terminal' } }
    return { authority: consumer, request }
  }
  const finishCaller = async (authority: Awaited<ReturnType<typeof invoice>>['authority'], successful = true) => {
    const inputIds = f.store.db.prepare('SELECT event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId).map(row => row.event_id as string)
    await f.engine.invocations.finish(authority, successful ? 'completed' : 'failed', 'Synthetic caller settlement', successful ? null : 'Synthetic failed caller', successful ? inputIds : [], [])
  }
  const complete = () => {
    const current = started.at(-1)!
    const input = workflowInput(f.store, current.id)!
    publishWorkflowOutput(f.store, current.id, { schema: 'invoice/v1', data: input.inputs!.invoice!.data })
    f.dispatcher.runs.finish(current.id, 'completed', 'Finite invoice result', null, [])
    workflows.tick(); calls.tick()
  }
  return { ...f, source, caller, sink, networkId, workflowId, legacyPod, workflows, calls, started, invoice, complete, finishCaller }
}

it('accepts repeated invoice requests once, releases the caller lease and retains a paused network result', async () => {
  const f = await fixture(); const { authority, request } = await f.invoice('INV-1')
  expect(f.calls.stage(authority, request)).toEqual({ requestId: request.requestId, duplicate: false })
  expect(f.calls.stage(authority, request)).toEqual({ requestId: request.requestId, duplicate: true })
  expect(() => f.calls.stage(authority, { ...request, inputs: { invoice: { version: 1, data: { subject: 'Conflicting invoice' } } } })).toThrow('conflicts')
  await f.engine.invocations.finish(authority, 'completed', 'Call accepted without waiting', null, f.store.db.prepare('SELECT event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(authority.runId).map(row => row.event_id as string), [])
  expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(f.caller)).toBeUndefined()
  f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(1)
  expect(workflowInput(f.store, f.started[0]!.id)).toMatchObject({ inputs: request.inputs, call: { requestId: request.requestId } })
  f.engine.execute({ type: 'pause', id: f.networkId, revision: 1 })
  f.complete(); f.calls.tick()
  expect(f.store.db.prepare('SELECT state,result FROM workflow_call_requests WHERE id=?').get(request.requestId)).toMatchObject({ state: 'completed', result: expect.any(String) })
  expect(f.store.db.prepare('SELECT 1 FROM workflow_call_result_events').get()).toBeUndefined()
  const archive = f.engine.execute({ type: 'archivePreview', id: f.networkId, revision: 1 }).archiveReview!
  expect(archive.issues).toContain('Deliver completed workflow results before changing the composition')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id: f.networkId, revision: 1, expectedFingerprint: archive.fingerprint })).toThrow('Deliver completed workflow results')
  const update = vi.fn()
  expect(() => f.engine.updateInstance(f.caller, update)).toThrow('Deliver completed workflow results')
  expect(update).not.toHaveBeenCalled()
  f.engine.execute({ type: 'activate', id: f.networkId, revision: 1 }); f.calls.tick(); f.calls.tick()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_runs').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events WHERE request_id=?').get(request.requestId)!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events WHERE channel=\'terminal\'').get()!.count).toBe(1)
  f.store.assertStorage()
})

it('stages call proposals until atomic caller completion and never dispatches a failed caller proposal', async () => {
  const f = await fixture(); const first = await f.invoice('INV-failed')
  f.calls.stage(first.authority, first.request)
  expect(f.calls.stage(first.authority, { ...first.request, requestId: randomUUID() })).toEqual({ requestId: first.request.requestId, duplicate: true })
  f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(0)
  expect(f.store.db.prepare('SELECT 1 FROM workflow_call_requests').get()).toBeUndefined()
  await f.finishCaller(first.authority, false)
  f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(0)
  expect(f.store.db.prepare('SELECT request_id FROM workflow_call_staging').get()).toBeUndefined()
  expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'workflow-call-proposals-abandoned\'').get()!.body).toContain(first.request.requestId)
  const independent = await f.invoice('INV-independent')
  f.calls.stage(independent.authority, independent.request); await f.finishCaller(independent.authority)
  f.calls.tick(); f.workflows.tick(); f.complete()
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_requests').get()!.count).toBe(1)
})

it('returns retained accepted receipts after permission drift without activating a new call', async () => {
  const f = await fixture(); const first = await f.invoice('INV-1')
  f.calls.stage(first.authority, first.request); await f.finishCaller(first.authority)
  f.store.db.prepare('UPDATE workflow_call_permissions SET revision=2,enabled=0').run()
  const repeat = await f.invoice('INV-1', 'repeat')
  expect(f.calls.stage(repeat.authority, { ...repeat.request, requestId: first.request.requestId })).toEqual({ requestId: first.request.requestId, duplicate: true })
  expect(f.calls.stage(repeat.authority, repeat.request)).toEqual({ requestId: first.request.requestId, duplicate: true })
  await f.finishCaller(repeat.authority)
  f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(0)
  expect(f.store.db.prepare('SELECT state,finished_at,result FROM workflow_call_requests').get()).toMatchObject({ state: 'blocked', finished_at: null, result: null })
  expect(f.store.db.prepare('SELECT permission_revision FROM workflow_call_controls').get()!.permission_revision).toBe(1)
  f.store.db.prepare('UPDATE workflow_call_permissions SET enabled=1').run()
  const next = await f.invoice('INV-2'); f.calls.stage(next.authority, next.request); await f.finishCaller(next.authority)
  f.calls.tick(); f.workflows.tick(); f.complete()
  expect(f.started).toHaveLength(1)
})

it('scopes result reads by case and cancels queued calls with a retained parent relationship', async () => {
  const f = await fixture(); const first = await f.invoice('INV-1')
  f.calls.stage(first.authority, first.request); await f.finishCaller(first.authority)
  await expect(f.calls.cancel(first.request.requestId, { ...f.owner, subject: 'another-owner' }, 'Synthetic cancellation')).rejects.toThrow('another owner')
  await f.calls.cancel(first.request.requestId, f.owner, 'Synthetic cancellation before dispatch')
  f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(0)
  const receipt = f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!
  expect(JSON.parse(receipt.cancellation_receipt as string)).toMatchObject({ callerInvocationId: first.authority.runId, workflowRunId: null, requestId: first.request.requestId })
  expect(f.store.db.prepare('SELECT state FROM workflow_call_requests').get()!.state).toBe('cancelled')
  const second = await f.invoice('INV-2')
  expect(() => f.calls.result(second.authority, { requestId: first.request.requestId })).toThrow('another caller or case')
  f.calls.stage(second.authority, second.request); await f.finishCaller(second.authority)
  f.calls.tick(); f.workflows.tick(); f.complete()
  expect(f.started).toHaveLength(1)
})

it.each([['approved', false], ['approved', true], ['denied', false], ['expired', false], ['unknown', false], ['ambiguous', false]] as const)('settles a required decision as %s with mixed channels %s', async (decision, mixed) => {
  let approved = false
  const operations: string[] = []
  const f = networkFixture({ gate: async (body) => {
    const { operation, manifest, grants } = body as { operation: string, manifest: { id: string, items: { key: string }[] }, grants?: { key: string }[] }
    operations.push(operation)
    if (operation === 'create') return { id: manifest.id, url: 'https://identity.example.invalid/approval', grants: manifest.items.map(item => ({ key: item.key, id: randomUUID() })) }
    if (operation === 'status') return Object.fromEntries(grants!.map(grant => [grant.key, approved ? decision === 'unknown' ? 'approved' : decision : 'pending']))
    if (operation === 'consume' && decision === 'unknown') throw new Error('Synthetic lost grant response')
    return undefined
  } })
  const source = f.pod('Network invoice source', { takes: [], gives: ['input'], summary: 'Invoice' }, async () => {})
  const caller = f.pod('Network caller', { takes: ['input'], gives: ['output', 'terminal'], summary: 'Finite request' }, async () => {})
  const sink = f.pod('Network result sink', { takes: ['output', 'terminal'], gives: [], summary: 'Finite results' }, async () => {})
  const root = f.pod('Finite source', { takes: [], gives: ['raw'], summary: 'Finite raw invoice' }, async (_items, request, input) => {
    await request('graph.emit', { channel: 'raw', key: input.workflow!.call!.requestId, data: input.workflow!.inputs!.invoice!.data })
  })
  const terminal = f.pod('Finite approved consumer', { takes: mixed ? ['approved', 'excluded'] : ['approved'], gives: [], summary: 'Required terminal' }, async (items, request) => {
    expect(items).toHaveLength(1)
    await request('workflow.publish', { schema: 'invoice/v1', data: items[0]!.data })
  })
  const members = [root, terminal]
  if (decision === 'ambiguous') members.push(f.pod('Second approved consumer', { takes: ['approved'], gives: [], summary: 'Separate grant required' }, async () => {}))
  const workflowId = randomUUID()
  const workflows = new WorkflowEngine(f.store, f.dispatcher, { inspect: vi.fn(async () => {}) })
  workflows.save({ type: 'save', id: workflowId, revision: 0, name: 'Required owner decision', groupId: f.groupId, mode: 'channels', nodes: members.map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, channels: ['raw', 'approved', 'excluded'].map(name => ({ name, title: name, fields: ['subject'] })), gates: [{ key: 'review', kind: 'approve', title: 'Approve invoice', takes: 'raw', gives: 'approved', excluded: mixed ? 'excluded' : null }], values: [] })
  workflows.pause(workflowId, 1, false)
  if (decision === 'ambiguous') {
    expect(() => workflows.publishRevision(workflowId, 2, { version: 1, inputs: [{ name: 'invoice', version: 1, schema, podId: root }], outputs: [{ name: 'result', version: 1, schema, podId: terminal, legacySchema: 'invoice/v1' }], requiredTerminals: [terminal], requiredGates: ['review'] })).toThrow('An approval gate needs exactly one pod that takes what it gives')
    expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_revisions').get()!.count).toBe(0)
    return
  }
  workflows.publishRevision(workflowId, 2, { version: 1, inputs: [{ name: 'invoice', version: 1, schema, podId: root }], outputs: [{ name: 'result', version: 1, schema, podId: terminal, legacySchema: 'invoice/v1' }], requiredTerminals: [terminal], requiredGates: ['review'] })
  const networkId = f.engine.execute({ type: 'create', draft: { name: 'Correlated approval network', groupId: f.groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[caller, sink].map(podId => ({ podId, source: null, serialCase: false }))], channels: ['input', 'output', 'terminal'].map(name => ({ name, title: name, schemaVersion: 1, schema: name === 'terminal' ? { type: 'object', properties: { requestId: { type: 'string' }, status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] } }, required: ['requestId', 'status'], additionalProperties: false } : schema })) } }).createdId!
  f.store.db.prepare('INSERT INTO workflow_call_permissions VALUES(?,?,?,?,?,?,?,1,1)').run(workflowId, 1, networkId, caller, f.owner.issuer, f.owner.subject, f.groupId)
  const calls = new WorkflowCalls(f.store, f.engine.invocations.events, workflows)
  f.engine.invocations.calls = calls
  f.engine.execute({ type: 'activate', id: networkId, revision: 1 })
  const sourceRun = f.engine.invocations.reserve(networkId, source, f.resources.epoch(source), 'manual')!
  await f.engine.invocations.finish(sourceRun, 'completed', 'Invoice', null, [], [{ channel: 'input', key: 'INV-1', sourceItemId: 'INV-1', sourceVersion: '1', payload: { subject: 'INV-1' } }])
  const callerRun = f.engine.invocations.reserve(networkId, caller, f.resources.epoch(caller), 'manual')!
  const requestId = randomUUID()
  calls.stage(callerRun, { requestId, workflowId, workflowRevision: 1, inputs: { invoice: { version: 1, data: { subject: 'INV-1' } } }, routes: { outputs: { result: 'output' }, terminal: 'terminal' } })
  await f.engine.invocations.finish(callerRun, 'completed', 'Queued', null, f.engine.invocations.input(callerRun).items.map(item => item.eventId), [])
  const idle = async () => vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  calls.tick(); workflows.tick(); await idle()
  workflows.tick(); await idle(); calls.tick()
  expect(f.started).toEqual([root])
  expect(operations).toEqual(['create'])
  expect(f.store.db.prepare('SELECT state,finished_at FROM workflow_runs').get()).toMatchObject({ state: 'running', finished_at: null })
  expect(f.store.db.prepare('SELECT result FROM workflow_call_requests').get()!.result).toBeNull()
  workflows.tick(); await idle()
  expect(operations).toEqual(['create'])
  approved = true
  f.store.db.prepare('UPDATE workflow_gate_poll_clocks SET next_poll_at=0').run()
  workflows.tick(); await idle()
  expect(f.started).toEqual([root])
  if (decision === 'unknown') {
    expect(workflows.view().gates!.batches[0]).toMatchObject({ state: 'unknown', url: 'https://identity.example.invalid/approval' })
    await calls.cancel(requestId, f.owner, 'Reviewed cancellation; retain uncertain grant receipt')
    workflows.tick(); calls.tick()
    const batch = workflows.view().gates!.batches[0]!
    expect(batch).toMatchObject({ state: 'unknown', url: null })
    expect(f.started).toEqual([root])
    expect(operations).toEqual(['create', 'status', 'consume'])
    discardGateBatch(f.store, batch.id, Date.now())
    expect(workflows.view().gates!.batches[0]!.state).toBe('denied')
    return
  }
  expect(operations).toEqual(decision === 'approved' ? ['create', 'status', 'consume'] : ['create', 'status'])
  workflows.tick(); await idle(); workflows.tick(); calls.tick()
  expect(f.started).toEqual(decision === 'approved' ? [root, terminal] : [root])
  expect(f.store.db.prepare('SELECT state FROM workflow_call_requests').get()!.state).toBe(decision === 'approved' ? 'completed' : 'failed')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_reservations').get()!.count).toBe(0)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_gate_attempts').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count).toBe(decision === 'approved' ? 2 : 1)
})

it('keeps two invoices in distinct FIFO executions and refuses missing or revoked call permissions', async () => {
  const f = await fixture(); const first = await f.invoice('INV-1')
  f.store.db.prepare('UPDATE workflow_call_permissions SET enabled=0').run()
  expect(() => f.calls.stage(first.authority, first.request)).toThrow('explicit same-company permission')
  f.store.db.prepare('UPDATE workflow_call_permissions SET enabled=1').run()
  f.calls.stage(first.authority, first.request)
  await f.engine.invocations.finish(first.authority, 'completed', 'First accepted', null, f.store.db.prepare('SELECT event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(first.authority.runId).map(row => row.event_id as string), [])
  const second = await f.invoice('INV-2'); f.calls.stage(second.authority, second.request)
  await f.engine.invocations.finish(second.authority, 'completed', 'Second accepted', null, f.store.db.prepare('SELECT event_id FROM network_deliveries WHERE run_id=? AND state=\'claimed\'').all(second.authority.runId).map(row => row.event_id as string), [])
  f.calls.tick(); f.workflows.tick(); f.calls.tick()
  expect(f.started).toHaveLength(1)
  f.complete(); f.workflows.tick()
  expect(f.started).toHaveLength(2)
  expect(workflowInput(f.store, f.started[1]!.id)).toMatchObject({ call: { requestId: second.request.requestId }, inputs: second.request.inputs })
  f.complete()
  const results = f.store.db.prepare('SELECT case_id,workflow_run_id,result FROM workflow_call_requests ORDER BY rowid').all()
  expect(results[0]!.case_id).not.toBe(results[1]!.case_id)
  expect(results[0]!.workflow_run_id).not.toBe(results[1]!.workflow_run_id)
  expect(JSON.parse(results[0]!.result as string).outputs.result.data.subject).toBe('INV-1')
  expect(JSON.parse(results[1]!.result as string).outputs.result.data.subject).toBe('INV-2')
})

it('fences restored calls until owner recovery and retains completed steps without replay', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-restored')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  const execution = f.started[0]!
  publishWorkflowOutput(f.store, execution.id, { schema: 'invoice/v1', data: invoice.request.inputs.invoice.data })
  f.dispatcher.runs.finish(execution.id, 'completed', 'Retained completed work', null, [])
  f.store.db.prepare('UPDATE workflow_call_requests SET state=\'unknown\'').run()
  f.workflows.tick(); f.calls.tick()
  expect(f.store.db.prepare('SELECT finished_at FROM workflow_runs').get()!.finished_at).toBeNull()
  expect(f.store.db.prepare('SELECT result FROM workflow_call_requests').get()!.result).toBeNull()
  await expect(f.calls.resume(invoice.request.requestId, { ...f.owner, subject: 'wrong-owner' }, 'Reviewed retained work')).rejects.toThrow('another owner')
  await f.calls.resume(invoice.request.requestId, f.owner, 'Reviewed retained execution and original invoice correlation')
  f.workflows.tick(); f.calls.tick()
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM workflow_call_requests').get()!.state).toBe('completed')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'workflow-call-owner-recovery\'').get()!.count).toBe(1)
})

it('delivers workflow results with the feedback hop their case has reached', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-hop')
  // Another branch of this case already reached hop 2; a call result must not reset the count.
  f.store.db.prepare('UPDATE network_events SET origin=json_set(origin,\'$.feedbackHop\',2) WHERE item_key=\'INV-hop\'').run()
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick(); f.complete()
  const results = f.store.db.prepare('SELECT json_extract(e.origin,\'$.feedbackHop\') AS hop,json_extract(e.origin,\'$.feedbackTransitionId\') AS transition FROM network_events e JOIN workflow_call_result_events r ON r.event_id=e.id').all()
  expect(results.map(row => [Number(row.hop), row.transition])).toEqual([[2, null], [2, null]])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE state=\'pending\'').get()!.count).toBe(2)
})

it('recovers retained result delivery with explicit owner evidence after permission drift', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-delivery')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  f.engine.execute({ type: 'pause', id: f.networkId, revision: 1 }); f.complete()
  f.store.db.prepare('UPDATE workflow_call_permissions SET revision=2').run()
  f.engine.execute({ type: 'activate', id: f.networkId, revision: 1 }); f.calls.tick()
  expect(f.store.db.prepare('SELECT delivery_state FROM workflow_call_controls').get()!.delivery_state).toBe('blocked')
  await f.calls.resume(invoice.request.requestId, f.owner, 'Verified the original completed result and current delivery permission')
  f.calls.tick(); f.calls.tick()
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT permission_revision FROM workflow_call_controls').get()!.permission_revision).toBe(2)
})

it('finishes a recorded cancellation after the original process stops without a second owner request', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-cancel')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  await expect(f.workflows.cancel(f.store.db.prepare('SELECT workflow_run_id FROM workflow_call_requests').get()!.workflow_run_id as string)).rejects.toThrow('owner evidence')
  await f.calls.cancel(invoice.request.requestId, f.owner, 'Cancel this finite invoice execution')
  const original = JSON.parse(f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!.cancellation_receipt as string)
  await f.calls.cancel(invoice.request.requestId, f.owner, 'Repeated cancellation while waiting for process exit')
  expect(JSON.parse(f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!.cancellation_receipt as string)).toMatchObject({ evidence: original.evidence, requestedAt: original.requestedAt })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'workflow-call-cancellation-requested\'').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT finished_at FROM workflow_call_requests').get()!.finished_at).toBeNull()
  f.dispatcher.runs.finish(f.started[0]!.id, 'cancelled', 'Original process stopped', null, [])
  await f.calls.reconcileCancellations(); f.calls.tick()
  expect(f.store.db.prepare('SELECT state FROM workflow_call_requests').get()!.state).toBe('cancelled')
  expect(JSON.parse(f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!.cancellation_receipt as string).outcome).toBe('cancelled')
  expect(f.started).toHaveLength(1)
})

it('bounds finished decision polling history while retaining the initial receipt and active execution', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-polling')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  const runId = f.store.db.prepare('SELECT workflow_run_id FROM workflow_call_requests').get()!.workflow_run_id!
  const initial = randomUUID()
  for (let index = 0; index < 101; index++) {
    const id = index === 0 ? initial : randomUUID()
    f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,\'Decision poll\',NULL,0,1)').run(id, f.legacyPod, f.store.getPod(f.legacyPod).activeScript!, ['completed', 'failed', 'cancelled'][index % 3]!, index, index + 1)
    f.store.db.prepare('INSERT INTO workflow_attempts VALUES(?,?,?)').run(id, runId, f.legacyPod)
    f.store.db.prepare('INSERT INTO workflow_gate_attempts VALUES(?,?,?,?)').run(id, invoice.request.requestId, JSON.stringify(['decision']), index)
  }
  const retention = new RunRetention(f.store)
  await retention.prune(); await retention.prune(); await retention.prune()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_gate_attempts').get()!.count).toBe(51)
  expect(f.store.db.prepare('SELECT 1 FROM runs WHERE id=?').get(initial)).toBeDefined()
  expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(f.started[0]!.id)).toBeDefined()
  expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('retains unprocessed inputs for owner review instead of completing or replaying successful work', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-overflow')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  const execution = f.started[0]!
  const workflowRunId = f.store.db.prepare('SELECT workflow_run_id FROM workflow_call_requests').get()!.workflow_run_id!
  const item = randomUUID()
  f.store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,?)').run(item, f.workflowId, workflowRunId, 'invoice-overflow', 'input', f.legacyPod, JSON.stringify({ subject: 'INV-overflow' }), Date.now())
  f.store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,?,NULL,?)').run(item, f.legacyPod, 'pending', Date.now())
  publishWorkflowOutput(f.store, execution.id, { schema: 'invoice/v1', data: invoice.request.inputs.invoice.data })
  f.dispatcher.runs.finish(execution.id, 'completed', 'Applied finite work', null, [])
  f.workflows.tick(); f.calls.tick(); f.workflows.tick()
  expect(f.store.db.prepare('SELECT state,reason,finished_at FROM workflow_runs').get()).toMatchObject({ state: 'blocked', reason: 'Completed workflow steps retain unprocessed inputs; owner review is required', finished_at: null })
  expect(f.store.db.prepare('SELECT result FROM workflow_call_requests').get()!.result).toBeNull()
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM graph_deliveries WHERE item_id=?').get(item)!.state).toBe('pending')
})

it('resolves a missing output only with explicit owner evidence while retaining completed effects', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-missing-output')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  f.dispatcher.runs.finish(f.started[0]!.id, 'completed', 'Applied work without a published output', null, [])
  f.workflows.tick(); f.calls.tick()
  expect(f.store.db.prepare('SELECT state,result FROM workflow_call_requests').get()).toMatchObject({ state: 'blocked', result: null })
  expect(f.store.db.prepare('SELECT state FROM workflow_runs').get()!.state).toBe('completed')
  await expect(f.calls.cancel(invoice.request.requestId, f.owner, 'Review the incomplete finite result')).rejects.toThrow('Required workflow output')
  await f.calls.reconcileCancellations()
  expect(JSON.parse(f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!.cancellation_receipt as string).outcome).toBe('owner-review-required')
  await expect(f.calls.resolveIncompleteResult(invoice.request.requestId, { ...f.owner, subject: 'wrong-owner' }, 'Retain applied effects')).rejects.toThrow('another owner')
  await f.calls.resolveIncompleteResult(invoice.request.requestId, f.owner, 'Verified completed effects; acknowledge missing result without replay')
  f.calls.tick(); f.calls.tick()
  const result = JSON.parse(f.store.db.prepare('SELECT result FROM workflow_call_requests').get()!.result as string)
  expect(result).toMatchObject({ status: 'failed', outputs: {}, reviewedIncompleteResult: true, completedEffectsRetained: true })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count).toBe(1)
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM workflow_runs').get()!.state).toBe('completed')
})

it('stops later finite steps when call permission is revoked and preserves completed predecessors', async () => {
  const f = await fixture()
  const terminal = f.store.createPod({ name: 'Finite second step' }).id
  const groups = new PodGroups(f.store)
  groups.execute({ type: 'organize', action: 'move', podId: terminal, groupId: f.groupId, revision: groups.view().revision })
  installExample(f.store, f.resources, terminal, 'deterministic', 'a'.repeat(64))
  f.workflows.save({ type: 'save', id: f.workflowId, revision: 2, name: 'Two finite steps', groupId: f.groupId, nodes: [{ podId: f.legacyPod, after: [], handoff: false }, { podId: terminal, after: [f.legacyPod], handoff: true }], schedule: null, enabled: false })
  const published = f.workflows.publishRevision(f.workflowId, 3, { version: 1, inputs: [{ name: 'invoice', version: 1, schema, podId: f.legacyPod }], outputs: [{ name: 'result', version: 1, schema, podId: terminal, legacySchema: 'invoice/v1' }], requiredTerminals: [terminal], requiredGates: [] })
  f.store.db.prepare('INSERT INTO workflow_call_permissions VALUES(?,?,?,?,?,?,?,1,1)').run(f.workflowId, published.revision, f.networkId, f.caller, f.owner.issuer, f.owner.subject, f.groupId)
  const invoice = await f.invoice('INV-revoked'); invoice.request.workflowRevision = published.revision
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  publishWorkflowOutput(f.store, f.started[0]!.id, { schema: 'invoice/v1', data: invoice.request.inputs.invoice.data })
  f.dispatcher.runs.finish(f.started[0]!.id, 'completed', 'Retained predecessor', null, [])
  f.store.db.prepare('UPDATE workflow_call_permissions SET enabled=0 WHERE workflow_revision=?').run(published.revision)
  f.workflows.tick(); f.calls.tick()
  expect(f.started).toHaveLength(1)
  expect(f.store.db.prepare('SELECT state FROM workflow_nodes WHERE pod_id=?').get(f.legacyPod)!.state).toBe('completed')
  expect(f.store.db.prepare('SELECT state,finished_at FROM workflow_runs').get()).toMatchObject({ state: 'blocked', finished_at: null })
  expect(f.store.db.prepare('SELECT state,result FROM workflow_call_requests').get()).toMatchObject({ state: 'blocked', result: null })
  f.store.db.prepare('UPDATE workflow_call_permissions SET enabled=1 WHERE workflow_revision=?').run(published.revision)
  await f.calls.resume(invoice.request.requestId, f.owner, 'Reviewed restored authority and retained predecessor')
  f.workflows.tick()
  expect(f.started).toHaveLength(2)
})

it('reauthorizes a cancelled terminal result without starting a child execution', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-cancelled-delivery')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  await f.calls.cancel(invoice.request.requestId, f.owner, 'Cancel before dispatch')
  f.store.db.prepare('UPDATE workflow_call_permissions SET revision=2').run()
  f.calls.tick()
  expect(f.store.db.prepare('SELECT delivery_state FROM workflow_call_controls').get()!.delivery_state).toBe('blocked')
  await f.calls.resume(invoice.request.requestId, f.owner, 'Reviewed cancelled result and current delivery rights')
  f.calls.tick(); f.calls.tick(); f.workflows.tick()
  expect(f.started).toHaveLength(0)
  expect(f.store.db.prepare('SELECT state,workflow_run_id FROM workflow_call_requests').get()).toMatchObject({ state: 'cancelled', workflow_run_id: null })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_call_result_events').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT cancellation_receipt FROM workflow_call_controls').get()!.cancellation_receipt).toBeTruthy()
})

it('retains completed workflow output until its call has settled despite later Pod history', async () => {
  const f = await fixture(); const invoice = await f.invoice('INV-retained-output')
  f.calls.stage(invoice.authority, invoice.request); await f.finishCaller(invoice.authority)
  f.calls.tick(); f.workflows.tick()
  const execution = f.started[0]!
  publishWorkflowOutput(f.store, execution.id, { schema: 'invoice/v1', data: invoice.request.inputs.invoice.data })
  f.dispatcher.runs.finish(execution.id, 'completed', 'Completed before call settlement', null, [])
  f.workflows.tick()
  expect(f.store.db.prepare('SELECT state FROM workflow_runs').get()!.state).toBe('completed')
  for (let index = 0; index < 60; index++) {
    f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'completed\',?,?,\'Later independent run\',NULL,0,1)').run(randomUUID(), f.legacyPod, f.store.getPod(f.legacyPod).activeScript!, Date.now() + index, Date.now() + index + 1)
  }
  await new RunRetention(f.store).prune()
  expect(f.store.db.prepare('SELECT output FROM workflow_nodes WHERE run_id=?').get(execution.id)!.output).toBeTruthy()
  f.calls.tick()
  expect(JSON.parse(f.store.db.prepare('SELECT result FROM workflow_call_requests').get()!.result as string).outputs.result.data.subject).toBe('INV-retained-output')
  expect(f.started).toHaveLength(1)
})

it('keeps called workflow definitions, members and derived runs out of legacy publication without removing them', async () => {
  const f = await fixture(); const first = await f.invoice('PRIVATE-CALL')
  f.calls.stage(first.authority, first.request); await f.finishCaller(first.authority)
  f.calls.tick(); f.workflows.tick(); f.complete()
  const retained = f.store.db.prepare('SELECT * FROM workflow_runs').all()
  expect(retained.length).toBeGreaterThan(0)
  const tables = networkPublicationTables(f.store)
  expect(tables.workflows).toEqual([])
  expect(tables.workflow_members).toEqual([])
  expect(tables.workflow_runs).toEqual([])
  expect(tables.workflow_nodes).toEqual([])
  expect(JSON.stringify(tables)).not.toContain('PRIVATE-CALL')
  expect(f.store.db.prepare('SELECT * FROM workflow_runs').all()).toEqual(retained)
})
