import { itemTitle } from '../../contracts/gates'
import type { GraphDetail, GraphEdge, GraphRight, GraphTraceEvent } from '../../contracts/graphs'
import { isHttpEffect } from '../../contracts/http'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'
import { inspectGraph } from './items'

/** Rights with a fixed label and the name, path or origin they apply to. Never a value or a secret. */
function rights(store: PodDatabase, podId: string): GraphRight[] {
  return store.db.prepare('SELECT kind,name,configuration FROM resources WHERE pod_id=? AND state=\'ready\' ORDER BY rowid').all(podId).flatMap((row): GraphRight[] => {
    const item = JSON.parse(row.configuration as string) as { type?: string, cliId?: string, access?: string, path?: string, origin?: string, methods?: string[], capability?: string }
    const name = row.name as string
    if (row.kind === 'directory') return [{ label: item.access === 'readWrite' ? 'Folder, read and write' : 'Folder, read only', target: item.path ?? name }]
    if (item.type === 'program') return [{ label: item.cliId === 'pods-mail' ? 'Move approved mail' : 'Program, read only', target: item.cliId ?? name }]
    if (item.type === 'http') return [{ label: (item.methods ?? []).some(isHttpEffect) ? 'HTTP, read and write' : 'HTTP, read only', target: item.origin ?? name }]
    if (item.capability === 'jev.evaluate') return [{ label: 'Jev decisions', target: '' }]
    if (item.capability === 'mail.read') return [{ label: 'Mail, read only', target: '' }]
    return []
  })
}

/** Edges of a sequence workflow come from `after`, so both modes draw the same picture. */
function sequenceEdges(definition: WorkflowDefinition): GraphEdge[] {
  return definition.nodes.flatMap(node => node.after.map(from => ({ from, to: node.podId, channel: '' })))
}

export function graphDetail(store: PodDatabase, definition: WorkflowDefinition | undefined, key?: string): GraphDetail | null {
  if (!definition) return null
  const inspected = inspectGraph(store, definition)
  const run = store.db.prepare('SELECT id,started_at,state FROM workflow_runs WHERE workflow_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(definition.id)
  const counts = run
    ? store.db.prepare('SELECT i.node AS origin,d.node AS target,i.channel,count(*) AS count FROM graph_items i JOIN graph_deliveries d ON d.item_id=i.id WHERE i.workflow_id=? AND i.workflow_run_id=? GROUP BY i.node,d.node,i.channel').all(definition.id, run.id as string).map(row => ({ from: row.origin as string, to: row.target as string, channel: row.channel as string, count: row.count as number }))
    : []
  const waiting = Object.fromEntries(store.db.prepare('SELECT d.node,count(*) AS count FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.state=\'pending\' GROUP BY d.node').all(definition.id).map(row => [row.node as string, row.count as number]))
  const title = (item: string) => {
    const row = store.db.prepare('SELECT payload FROM graph_items WHERE workflow_id=? AND key=? ORDER BY rowid DESC LIMIT 1').get(definition.id, item)
    return row ? itemTitle(item, JSON.parse(row.payload as string)) : item
  }
  const items = store.db.prepare('SELECT key,node,outcome FROM graph_item_events WHERE id IN (SELECT max(id) FROM graph_item_events WHERE workflow_id=? GROUP BY key) ORDER BY id DESC LIMIT 100').all(definition.id).map(row => ({ key: row.key as string, title: title(row.key as string), outcome: row.outcome as string, node: row.node as string }))
  const events = key === undefined ? [] : store.db.prepare('SELECT node,outcome,channel,reason,confidence,at FROM graph_item_events WHERE workflow_id=? AND key=? ORDER BY id LIMIT 200').all(definition.id, key) as unknown as GraphTraceEvent[]
  return {
    workflowId: definition.id,
    contracts: inspected.contracts,
    edges: definition.mode === 'channels' ? inspected.edges : sequenceEdges(definition),
    nodeKinds: inspected.nodeKinds,
    diagnostics: inspected.diagnostics,
    rights: Object.fromEntries(definition.nodes.map(node => [node.podId, rights(store, node.podId)])),
    lastRun: run ? { id: run.id as string, startedAt: run.started_at as number, state: run.state as string } : null,
    counts,
    waiting,
    items,
    trace: key === undefined ? null : { key, title: title(key), events: events.map(event => ({ ...event })) },
  }
}
