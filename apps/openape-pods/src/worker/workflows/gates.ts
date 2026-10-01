import type { NetworkGates, NetworkGateService, NetworkGateStep } from '../scheduling/network-gates'
import type { NetworkAuthority } from '../scheduling/network-events'
import type { NetworkGateCoverage } from '../../contracts/network-gates'
import { randomUUID } from 'node:crypto'
import { gateDigest, gateLimits, gateSummary, itemTitle, payloadHash } from '../../contracts/gates'
import type { GateBatchItem, GateBatchState, GateBatchView, GateCoverage, GateHeldItem, GateManifest } from '../../contracts/gates'
import type { GraphGate } from '../../contracts/graphs'
import { InfrastructureError } from '../../contracts/infrastructure'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'
import { graphNodes, inspectGraph } from './items'
import type { DeliveredItem, GraphRun } from './items'

export type GateService = (body: { operation: 'create' | 'status' | 'consume', manifest: GateManifest, grantId?: string }) => Promise<unknown>
type ApproveGate = Extract<GraphGate, { kind: 'approve' }>
interface Batch { id: string, workflowId: string, gate: string, podId: string, state: GateBatchState, grantId: string | null, url: string | null, title: string, digest: string, expiresAt: number, items: GateBatchItem[], error: string | null }
interface Held { id: string, key: string, payload: string, workflowRunId: string }

const open = ['preparing', 'pending', 'consuming', 'unknown']
const node = (gate: string) => `gate:${gate}`
function batches(store: PodDatabase, where: string, ...values: (string | number)[]): Batch[] {
  return store.db.prepare(`SELECT * FROM graph_gate_batches WHERE ${where} ORDER BY created_at,rowid`).all(...values).map(row => ({ id: row.id as string, workflowId: row.workflow_id as string, gate: row.gate as string, podId: row.pod_id as string, state: row.state as GateBatchState, grantId: row.grant_id as string | null, url: row.url as string | null, title: row.title as string, digest: row.digest as string, expiresAt: row.expires_at as number, items: JSON.parse(row.items as string), error: row.error as string | null }))
}
function batch(store: PodDatabase, id: string): Batch {
  const [found] = batches(store, 'id=?', id)
  if (!found) throw new Error('Gate batch not found')
  return found
}
function update(store: PodDatabase, id: string, state: GateBatchState, now: number, change: { grantId?: string, url?: string, error?: string, items?: GateBatchItem[] } = {}): void {
  store.db.prepare('UPDATE graph_gate_batches SET state=?,grant_id=coalesce(?,grant_id),url=coalesce(?,url),error=?,items=coalesce(?,items),updated_at=? WHERE id=?').run(state, change.grantId ?? null, change.url ?? null, change.error ?? null, change.items ? JSON.stringify(change.items) : null, now, id)
}
const manifest = (item: Batch): GateManifest => ({ version: 1, id: item.id, workflowId: item.workflowId, gate: item.gate, title: item.title, podId: item.podId, expiresAt: item.expiresAt, digest: item.digest, items: item.items.map(({ key, hash, title }) => ({ key, hash, title })) })
function held(store: PodDatabase, itemId: string): Held {
  const row = store.db.prepare('SELECT id,key,payload,workflow_run_id FROM graph_items WHERE id=?').get(itemId)
  if (!row) throw new Error('Gate item not found')
  return { id: row.id as string, key: row.key as string, payload: row.payload as string, workflowRunId: row.workflow_run_id as string }
}
function record(store: PodDatabase, workflowId: string, item: Held, gate: string, outcome: string, channel: string | null, reason: string | null, now: number): void {
  store.db.prepare('INSERT INTO graph_item_events(workflow_id,workflow_run_id,key,node,outcome,channel,reason,confidence,at) VALUES(?,?,?,?,?,?,?,NULL,?)').run(workflowId, item.workflowRunId, item.key, node(gate), outcome, channel, reason, now)
}
/** Ends the stay of an item at a gate and, with a channel, hands it to every node that takes that channel. */
function release(store: PodDatabase, workflowId: string, gate: string, item: Held, outcome: string, channel: string | null, reason: string | null, consumers: string[], now: number): string | null {
  store.db.prepare('UPDATE graph_deliveries SET state=\'done\',updated_at=? WHERE item_id=? AND node=? AND state=\'pending\'').run(now, item.id, node(gate))
  record(store, workflowId, item, gate, outcome, channel, reason, now)
  if (!channel) return null
  const id = randomUUID()
  store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,?)').run(id, workflowId, item.workflowRunId, item.key, channel, node(gate), item.payload, now)
  for (const consumer of consumers) store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,\'pending\',NULL,?)').run(id, consumer, now)
  return id
}
function definitionOf(store: PodDatabase, workflowId: string): WorkflowDefinition {
  const row = store.db.prepare('SELECT * FROM workflows WHERE id=? AND archived=0').get(workflowId)
  if (!row) throw new Error('Workflow not found')
  return { id: workflowId, revision: row.revision as number, name: row.name as string, nodes: JSON.parse(row.nodes as string), schedule: null, enabled: row.enabled === 1, paused: row.paused === 1, nextAt: null, mode: row.mode as WorkflowDefinition['mode'], groupId: row.group_id as string | null, channels: [], values: [], gates: store.db.prepare('SELECT definition FROM workflow_gates WHERE workflow_id=? ORDER BY rowid').all(workflowId).map(gate => JSON.parse(gate.definition as string)) }
}
/** Nodes that take a channel, by the scripts that are active now. Used for decisions outside a run. */
function consumersNow(store: PodDatabase, definition: WorkflowDefinition, channel: string): string[] {
  const { contracts } = inspectGraph(store, definition)
  return [...definition.nodes.filter(member => contracts[member.podId]?.takes.includes(channel)).map(member => member.podId), ...definition.gates.filter(gate => gate.takes === channel).map(gate => node(gate.key))]
}
function pool(store: PodDatabase, workflowId: string, gate: string): Held[] {
  const taken = new Set(batches(store, `workflow_id=? AND gate=? AND state IN (${open.map(() => '?').join(',')})`, workflowId, gate, ...open).flatMap(item => item.items.map(entry => entry.itemId)))
  return store.db.prepare('SELECT i.id,i.key,i.payload,i.workflow_run_id FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.node=? AND d.state=\'pending\' ORDER BY i.created_at,i.rowid').all(workflowId, node(gate)).map(row => ({ id: row.id as string, key: row.key as string, payload: row.payload as string, workflowRunId: row.workflow_run_id as string })).filter(item => !taken.has(item.id))
}

/** True while a gate holds items or waits for a decision, so its consumer has a reason to run. */
export function gateNeedsRound(store: PodDatabase, workflowId: string, gate: string): boolean {
  return !!store.db.prepare('SELECT 1 FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.node=? AND d.state=\'pending\' LIMIT 1').get(workflowId, node(gate))
}

function settle(store: PodDatabase, item: Batch, state: 'denied' | 'expired', reason: string | null, now: number): void {
  store.transaction(() => {
    for (const entry of item.items) release(store, item.workflowId, item.gate, held(store, entry.itemId), state === 'denied' ? 'refused' : 'expired', null, reason, [], now)
    update(store, item.id, state, now, { error: reason ?? undefined })
  })
}

/**
 * One round of every approval gate in front of the running Pod: read decisions, hand approved
 * items on and request approval for one new batch. Nothing is handed on without a consumed grant.
 */
async function legacyGateRound(store: PodDatabase, run: GraphRun, service: GateService, now: () => number = Date.now): Promise<void> {
  const nodes = graphNodes(store, run.workflowRunId, run.definition)
  const gates = run.definition.gates.filter((gate): gate is ApproveGate => gate.kind === 'approve' && nodes.some(item => item.id === run.node && item.takes.includes(gate.gives)))
  for (const gate of gates) {
    for (const interrupted of batches(store, 'workflow_id=? AND gate=? AND state IN (\'preparing\',\'consuming\')', run.workflowId, gate.key)) update(store, interrupted.id, 'unknown', now(), { error: 'Interrupted approval; inspect the grant before proceeding' })
    if (batches(store, 'workflow_id=? AND gate=? AND state=\'unknown\'', run.workflowId, gate.key).length) continue
    for (const pending of batches(store, 'workflow_id=? AND gate=? AND state=\'pending\'', run.workflowId, gate.key)) {
      if (pending.expiresAt <= now()) { settle(store, pending, 'expired', null, now()); continue }
      try {
        const status = await service({ operation: 'status', manifest: manifest(pending), grantId: pending.grantId! })
        if (status === 'pending') continue
        if (status === 'denied' || status === 'expired') { settle(store, pending, status, null, now()); continue }
        if (status !== 'approved') throw new Error('Invalid approval status')
        update(store, pending.id, 'consuming', now())
        await service({ operation: 'consume', manifest: manifest(pending), grantId: pending.grantId! })
        store.transaction(() => {
          const items = pending.items.map(entry => ({ ...entry, emittedId: release(store, run.workflowId, gate.key, held(store, entry.itemId), 'approved', gate.gives, null, [run.node], now()) }))
          update(store, pending.id, 'approved', now(), { items })
        })
      }
      catch (error) {
        if (error instanceof InfrastructureError && batch(store, pending.id).state === 'pending') throw error
        update(store, pending.id, 'unknown', now(), { error: error instanceof Error ? error.message : 'Approval failed' })
        break
      }
    }
    if (batches(store, 'workflow_id=? AND gate=? AND state=\'unknown\'', run.workflowId, gate.key).length) continue
    if (batches(store, 'workflow_id=? AND gate=? AND state=\'pending\'', run.workflowId, gate.key).length >= gateLimits.pendingBatches) continue
    const items = pool(store, run.workflowId, gate.key).slice(0, gateLimits.batchItems).map((item): GateBatchItem => {
      const data = JSON.parse(item.payload) as Record<string, unknown>
      return { itemId: item.id, key: item.key, hash: payloadHash(data), title: itemTitle(item.key, data), excluded: false, emittedId: null }
    })
    // An item with the same key is approved once per batch; the rest waits for the next one.
    const unique = items.filter((item, index) => items.findIndex(other => other.key === item.key) === index)
    const frozen: Batch = { id: randomUUID(), workflowId: run.workflowId, gate: gate.key, podId: run.node, state: 'preparing', grantId: null, url: null, title: gate.title, digest: '', expiresAt: now() + gateLimits.expiryMs, items: unique, error: null }
    while (frozen.items.length && gateSummary(manifest(frozen)).length > gateLimits.summaryLength) frozen.items.pop()
    if (!frozen.items.length) continue
    frozen.digest = gateDigest(frozen.items)
    store.transaction(() => {
      store.db.prepare('INSERT INTO graph_gate_batches VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,NULL,?,?)').run(frozen.id, frozen.workflowId, frozen.gate, frozen.podId, frozen.state, frozen.title, frozen.digest, frozen.expiresAt, JSON.stringify(frozen.items), now(), now())
      for (const entry of frozen.items) record(store, frozen.workflowId, held(store, entry.itemId), frozen.gate, 'held', gate.takes, null, now())
    })
    try {
      const grant = await service({ operation: 'create', manifest: manifest(frozen) }) as { id?: unknown, url?: unknown }
      if (typeof grant?.id !== 'string' || typeof grant.url !== 'string') throw new Error('Invalid approval grant response')
      update(store, frozen.id, 'pending', now(), { grantId: grant.id, url: grant.url })
    }
    catch (error) { update(store, frozen.id, 'unknown', now(), { error: `Grant creation requires review: ${error instanceof Error ? error.message : 'unknown error'}` }) }
  }
}

export type GateExecutionContext = { version: 1, run: GraphRun } | { version: 2, network: NetworkGates, step: NetworkGateStep, signal: AbortSignal }

export function gateRound(store: PodDatabase, run: GraphRun | Extract<GateExecutionContext, { version: 1 }>, service: GateService, now?: () => number): Promise<void>
export function gateRound(store: PodDatabase, context: Extract<GateExecutionContext, { version: 2 }>, service: NetworkGateService): Promise<void>
export async function gateRound(store: PodDatabase, context: GraphRun | GateExecutionContext, service: GateService | NetworkGateService, now: () => number = Date.now): Promise<void> {
  if ('version' in context && context.version === 2) { await context.network.round(context.step, service as NetworkGateService, context.signal); return }
  await legacyGateRound(store, 'version' in context ? context.run : context, service as GateService, now)
}

/** The consumed batches behind the items a Pod received in this run. */
function legacyGateCoverage(store: PodDatabase, run: GraphRun, delivered: DeliveredItem[]): GateCoverage[] {
  return batches(store, 'workflow_id=? AND pod_id=? AND state=\'approved\'', run.workflowId, run.node).map(item => ({ manifest: manifest(item), grantId: item.grantId!, items: delivered.filter(received => item.items.some(entry => entry.emittedId === received.id)).map(({ key, data }) => ({ key, data })) })).filter(coverage => coverage.items.length)
}

export function gateCoverage(store: PodDatabase, run: GraphRun, delivered: DeliveredItem[]): GateCoverage[]
export function gateCoverage(store: PodDatabase, context: { version: 2, network: NetworkGates, authority: NetworkAuthority }): NetworkGateCoverage[]
export function gateCoverage(store: PodDatabase, context: GraphRun | { version: 2, network: NetworkGates, authority: NetworkAuthority }, delivered: DeliveredItem[] = []): GateCoverage[] | NetworkGateCoverage[] {
  return 'version' in context ? context.network.coverage(context.authority) : legacyGateCoverage(store, context, delivered)
}

/** Owner decision in the app: the excluded items leave the batch and its pending grant is never consumed. */
export function excludeGateItems(store: PodDatabase, batchId: string, itemIds: string[], now: number): void {
  store.transaction(() => {
    const item = batch(store, batchId)
    if (item.state !== 'pending') throw new Error('Only a batch that awaits approval can be changed')
    if (!itemIds.length || itemIds.some(id => !item.items.some(entry => entry.itemId === id))) throw new Error('Item is not part of this batch')
    const definition = definitionOf(store, item.workflowId)
    const gate = definition.gates.find((candidate): candidate is ApproveGate => candidate.kind === 'approve' && candidate.key === item.gate)
    if (!gate) throw new Error('Gate not found')
    const consumers = gate.excluded ? consumersNow(store, definition, gate.excluded) : []
    for (const id of itemIds) release(store, item.workflowId, item.gate, held(store, id), 'excluded', gate.excluded, null, consumers, now)
    update(store, batchId, 'superseded', now, { items: item.items.map(entry => ({ ...entry, excluded: itemIds.includes(entry.itemId) })) })
  })
}

/** Owner decision in the app: one held item goes to the channel of the chosen option. */
export function chooseGateItem(store: PodDatabase, workflowId: string, gateKey: string, itemId: string, option: string, now: number): void {
  store.transaction(() => {
    const definition = definitionOf(store, workflowId)
    const gate = definition.gates.find(candidate => candidate.kind === 'choose' && candidate.key === gateKey)
    const chosen = gate?.kind === 'choose' ? gate.options.find(candidate => candidate.key === option) : undefined
    if (!gate || !chosen) throw new Error('Gate option not found')
    if (!store.db.prepare('SELECT 1 FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE d.item_id=? AND d.node=? AND d.state=\'pending\' AND i.workflow_id=?').get(itemId, node(gateKey), workflowId)) throw new Error('Item is not held by this gate')
    release(store, workflowId, gateKey, held(store, itemId), 'chosen', chosen.channel, chosen.title, consumersNow(store, definition, chosen.channel), now)
  })
}

/** Owner reconciliation of an unknown outcome. The only offered outcome hands nothing on. */
export function discardGateBatch(store: PodDatabase, batchId: string, now: number): void {
  const item = batch(store, batchId)
  if (item.state !== 'unknown') throw new Error('Only a batch with an unknown outcome needs reconciliation')
  settle(store, item, 'denied', 'Discarded after review', now)
}

export function gateView(store: PodDatabase): { batches: GateBatchView[], held: GateHeldItem[] } {
  const recent = batches(store, 'state IN (\'pending\',\'unknown\',\'preparing\',\'consuming\') OR id IN (SELECT id FROM graph_gate_batches ORDER BY updated_at DESC LIMIT 20)')
  const choose = store.db.prepare('SELECT w.id,g.definition FROM workflow_gates g JOIN workflows w ON w.id=g.workflow_id WHERE w.archived=0').all().map(row => ({ workflowId: row.id as string, gate: JSON.parse(row.definition as string) as GraphGate })).filter(item => item.gate.kind === 'choose')
  return {
    batches: recent.map(item => ({ id: item.id, workflowId: item.workflowId, gate: item.gate, podId: item.podId, state: item.state, url: item.url, expiresAt: item.expiresAt, error: item.error, items: item.items.map(({ itemId, key, title, excluded }) => ({ itemId, key, title, excluded })) })),
    held: choose.flatMap(({ workflowId, gate }) => pool(store, workflowId, gate.key).slice(0, 100).map(item => ({ itemId: item.id, workflowId, gate: gate.key, key: item.key, title: itemTitle(item.key, JSON.parse(item.payload)) }))),
  }
}
