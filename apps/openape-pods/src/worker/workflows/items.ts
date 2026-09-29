import { randomUUID } from 'node:crypto'
import { deriveEdges, diagnoseGraph, graphLimits, parseGraphContract } from '../../contracts/graphs'
import type { GraphContract, GraphDiagnostic, GraphEdge, GraphEmit, GraphGate, GraphItem, GraphMemberFacts, GraphNodeKind } from '../../contracts/graphs'
import { isHttpEffect } from '../../contracts/http'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'

export const retainedItemRuns = 3
// One runner reply holds every item of a run and must stay below the 256 KiB frame limit.
const deliveryBytes = 200 * 1024

export interface GraphNode { id: string, takes: string[], gives: string[] }
export interface DeliveredItem extends GraphItem { id: string }
export interface GraphRun { workflowId: string, workflowRunId: string, node: string, definition: WorkflowDefinition }

const gateNode = (gate: GraphGate): GraphNode => ({ id: `gate:${gate.key}`, takes: [gate.takes], gives: gate.kind === 'approve' ? [gate.gives, ...gate.excluded === null ? [] : [gate.excluded]] : gate.options.map(option => option.channel) })

function manifestOf(store: PodDatabase, podId: string, hash: string | null): { contract?: unknown, capabilities?: string[] } {
  const row = hash ? store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, hash) : undefined
  return row ? JSON.parse(row.manifest as string) : {}
}
function contractOf(store: PodDatabase, podId: string, hash: string | null): GraphContract | null {
  const { contract } = manifestOf(store, podId, hash)
  return contract === undefined ? null : parseGraphContract(contract)
}

/** The contract of the active script of every Pod that has one. */
export function podContracts(store: PodDatabase): Record<string, GraphContract | null> {
  return Object.fromEntries(store.db.prepare('SELECT id,active_script FROM pods WHERE active_script IS NOT NULL').all().map(row => [row.id as string, contractOf(store, row.id as string, row.active_script as string)]))
}

/** Diagnostics of a saved graph against the active scripts and rights of its member Pods. */
export function inspectGraph(store: PodDatabase, definition: WorkflowDefinition): { contracts: Record<string, GraphContract | null>, edges: GraphEdge[], nodeKinds: Record<string, GraphNodeKind>, diagnostics: GraphDiagnostic[] } {
  const contracts: Record<string, GraphContract | null> = {}; const facts: Record<string, GraphMemberFacts> = {}
  const nodeKinds: Record<string, GraphNodeKind> = Object.fromEntries(definition.gates.map(gate => [`gate:${gate.key}`, 'gate']))
  for (const { podId } of definition.nodes) {
    const active = store.getPod(podId).activeScript
    contracts[podId] = contractOf(store, podId, active)
    const rights = store.db.prepare('SELECT kind,configuration FROM resources WHERE pod_id=? AND state=\'ready\'').all(podId).map(row => ({ kind: row.kind as string, ...JSON.parse(row.configuration as string) as { cliId?: string, access?: string, type?: string, methods?: string[] } }))
    const writes = rights.some(right => right.cliId === 'pods-mail' || (right.kind === 'directory' && right.access === 'readWrite') || (right.type === 'http' && (right.methods ?? []).some(isHttpEffect)))
    nodeKinds[podId] = writes ? 'effect' : manifestOf(store, podId, active).capabilities?.includes('jev.evaluate') ? 'decision' : 'code'
    const group = store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(podId)?.group_id ?? null
    facts[podId] = {
      archive: store.db.prepare('SELECT configuration FROM resources WHERE pod_id=? AND kind=\'tool\' AND state=\'ready\'').all(podId).some(row => (JSON.parse(row.configuration as string) as { cliId?: string }).cliId === 'pods-mail'),
      elsewhere: group !== definition.groupId || !!store.db.prepare('SELECT 1 FROM workflow_members m JOIN workflows w ON w.id=m.workflow_id WHERE m.pod_id=? AND m.workflow_id!=? AND w.archived=0').get(podId, definition.id),
      variables: store.db.prepare('SELECT name FROM pod_variables WHERE pod_id=?').all(podId).map(row => row.name as string),
    }
  }
  const members = definition.nodes.flatMap(({ podId }) => contracts[podId] ? [{ podId, contract: contracts[podId] }] : [])
  return { contracts, edges: deriveEdges(members, definition.gates), nodeKinds, diagnostics: diagnoseGraph(definition, contracts, facts) }
}

/** Nodes of one run, with the contracts of the scripts pinned when the run started. */
export function graphNodes(store: PodDatabase, workflowRunId: string, definition: WorkflowDefinition): GraphNode[] {
  const pinned = store.db.prepare('SELECT pod_id,script_hash FROM workflow_nodes WHERE workflow_run_id=? ORDER BY rowid').all(workflowRunId)
  return [...pinned.map((row) => {
    const contract = contractOf(store, row.pod_id as string, row.script_hash as string | null)
    return { id: row.pod_id as string, takes: contract?.takes ?? [], gives: contract?.gives ?? [] }
  }), ...definition.gates.map(gateNode)]
}

export function graphRun(store: PodDatabase, runId: string): GraphRun | undefined {
  const attempt = store.db.prepare('SELECT a.pod_id,w.id,w.workflow_id,w.definition FROM workflow_attempts a JOIN workflow_runs w ON w.id=a.workflow_run_id WHERE a.run_id=?').get(runId)
  if (!attempt) return undefined
  const definition = JSON.parse(attempt.definition as string) as WorkflowDefinition
  if (definition.mode !== 'channels') return undefined
  return { workflowId: attempt.workflow_id as string, workflowRunId: attempt.id as string, node: attempt.pod_id as string, definition }
}

export function hasPendingItems(store: PodDatabase, workflowId: string, node: string): boolean {
  return !!store.db.prepare('SELECT 1 FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.node=? AND d.state=\'pending\' LIMIT 1').get(workflowId, node)
}

/** The oldest pending items of a node, bounded by count and by the size of one runner reply. */
export function pendingItems(store: PodDatabase, workflowId: string, node: string): DeliveredItem[] {
  const rows = store.db.prepare('SELECT i.id,i.key,i.channel,i.payload FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.node=? AND d.state=\'pending\' ORDER BY i.created_at,i.rowid LIMIT ?').all(workflowId, node, graphLimits.emits)
  const items: DeliveredItem[] = []; let bytes = 0
  for (const row of rows) {
    const item = { id: row.id as string, key: row.key as string, channel: row.channel as string, data: JSON.parse(row.payload as string) as Record<string, unknown> }
    bytes += Buffer.byteLength(JSON.stringify(item))
    if (bytes > deliveryBytes) break
    items.push(item)
  }
  return items
}

/**
 * Settles one node run. A completed run consumes its delivered items and hands its emits to every
 * consumer in one transaction. Any other outcome writes no item and leaves every delivery pending.
 */
export function settleItems(store: PodDatabase, run: GraphRun, completed: boolean, delivered: DeliveredItem[], emits: (GraphEmit & { channel: string })[], now: number): void {
  store.transaction(() => {
    const event = store.db.prepare('INSERT INTO graph_item_events(workflow_id,workflow_run_id,key,node,outcome,channel,reason,confidence,at) VALUES(?,?,?,?,?,?,?,?,?)')
    for (const item of delivered) {
      event.run(run.workflowId, run.workflowRunId, item.key, run.node, completed ? 'consumed' : 'failed', item.channel, null, null, now)
      if (completed) store.db.prepare('UPDATE graph_deliveries SET state=\'done\',workflow_run_id=?,updated_at=? WHERE item_id=? AND node=? AND state=\'pending\'').run(run.workflowRunId, now, item.id, run.node)
    }
    if (!completed) return
    const nodes = graphNodes(store, run.workflowRunId, run.definition)
    for (const emit of emits) {
      const id = randomUUID()
      store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,?)').run(id, run.workflowId, run.workflowRunId, emit.key, emit.channel, run.node, JSON.stringify(emit.data), now)
      event.run(run.workflowId, run.workflowRunId, emit.key, run.node, 'emitted', emit.channel, emit.reason ?? null, emit.confidence ?? null, now)
      for (const consumer of nodes.filter(node => node.takes.includes(emit.channel))) store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,\'pending\',NULL,?)').run(id, consumer.id, now)
    }
  })
}

/** Keeps the items of the most recent runs per graph and every item that is still pending somewhere. */
export function pruneItems(store: PodDatabase): void {
  store.transaction(() => {
    store.db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS retained_items(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, key TEXT NOT NULL);
      DELETE FROM retained_items;
      INSERT INTO retained_items
        SELECT i.id,i.workflow_id,i.key FROM graph_items i
        WHERE i.workflow_run_id IN (
          SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY workflow_id ORDER BY started_at DESC, rowid DESC) AS position FROM workflow_runs) WHERE position <= ${retainedItemRuns}
        ) OR EXISTS (SELECT 1 FROM graph_deliveries d WHERE d.item_id=i.id AND d.state='pending');
      DELETE FROM graph_item_events WHERE NOT EXISTS (SELECT 1 FROM retained_items r WHERE r.workflow_id=graph_item_events.workflow_id AND r.key=graph_item_events.key);
      DELETE FROM graph_deliveries WHERE item_id NOT IN (SELECT id FROM retained_items);
      DELETE FROM graph_items WHERE id NOT IN (SELECT id FROM retained_items);
      DELETE FROM graph_gate_batches WHERE state IN ('approved','denied','expired','superseded') AND NOT EXISTS (
        SELECT 1 FROM json_each(graph_gate_batches.items) entry JOIN retained_items r ON r.id IN (json_extract(entry.value,'$.itemId'), json_extract(entry.value,'$.emittedId'))
      );
      DELETE FROM retained_items;
    `)
  })
}
