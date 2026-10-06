import { itemTitle, graphRowTables, inspectRows, projectGraph } from '../../../openape-pods/src/contracts/graph-projection'
import type { GraphRows } from '../../../openape-pods/src/contracts/graph-projection'
import type { GraphGate } from '../../../openape-pods/src/contracts/graphs'
import { parseWorkflowView, parseWorkflowNodes } from '../../../openape-pods/src/contracts/workflows'
import type { WorkflowDefinition, WorkflowView } from '../../../openape-pods/src/contracts/workflows'

const tracedItems = 20
const open = ['preparing', 'pending', 'consuming', 'unknown']

export function workspaceWorkflows(read: (key: string) => unknown, keys: string[]): WorkflowView | undefined {
  if (!keys.includes('table/workflows/0')) return undefined
  function rows(table: string): Record<string, unknown>[] {
    return keys.filter(key => key.startsWith(`table/${table}/`)).sort((a, b) => Number(a.split('/')[2]) - Number(b.split('/')[2])).flatMap(key => read(key) as Record<string, unknown>[])
  }
  function json(value: unknown): unknown {
    if (typeof value !== 'string') throw new Error('Invalid workflow archive')
    return JSON.parse(value)
  }
  function flag(value: unknown): boolean {
    if (value !== 0 && value !== 1) throw new Error('Invalid workflow flag')
    return value === 1
  }
  const parts = (table: string, id: unknown) => rows(table).filter(row => row.workflow_id === id)
  // Rows of a desktop that knows no graphs carry neither mode nor group and read as a sequence.
  const workflows = rows('workflows').filter(row => !flag(row.archived)).map(row => ({
    id: row.id, revision: row.revision, name: row.name, nodes: json(row.nodes),
    schedule: row.schedule === null ? null : json(row.schedule), enabled: flag(row.enabled),
    paused: flag(row.paused), nextAt: row.next_at,
    mode: row.mode ?? 'sequence', groupId: row.group_id ?? null,
    channels: parts('workflow_channels', row.id).map(item => ({ name: item.name, title: item.title, fields: json(item.fields) })),
    gates: parts('workflow_gates', row.id).map(item => json(item.definition)),
    values: parts('workflow_values', row.id).map(item => ({ name: item.name, value: item.value, revision: item.revision })),
  }))
  const nodes = rows('workflow_nodes')
  const runs = rows('workflow_runs').sort((a, b) => Number(a.finished_at !== null) - Number(b.finished_at !== null) || Number(b.started_at) - Number(a.started_at)).slice(0, 100).map((row) => {
    const definition = json(row.definition) as Record<string, unknown>
    const graph = parseWorkflowNodes(definition.nodes)
    return {
      id: row.id, workflowId: row.workflow_id, revision: row.revision, paused: flag(row.paused),
      state: row.state, reason: row.reason, startedAt: row.started_at, finishedAt: row.finished_at,
      nodes: nodes.filter(node => node.workflow_run_id === row.id).map((node) => {
        const dependency = graph.find(item => item.podId === node.pod_id)
        if (!dependency) throw new Error('Invalid workflow node binding')
        return { ...dependency, state: node.state, reason: node.reason, runId: node.run_id, scriptHash: node.script_hash }
      }),
    }
  })
  const view = parseWorkflowView({ workflows, runs })
  if (!keys.includes('table/graph_items/0') && !view.workflows.some(item => item.mode === 'channels')) return view
  const stored = Object.fromEntries(Object.entries(graphRowTables).map(([name, table]) => [name, rows(table)])) as unknown as GraphRows
  const batches = rows('graph_gate_batches').map(row => ({ id: row.id, workflowId: row.workflow_id, gate: row.gate, podId: row.pod_id, state: row.state, url: row.url, expiresAt: row.expires_at, error: row.error, items: (json(row.items) as { itemId: string, key: string, title: string, excluded: boolean }[]).map(({ itemId, key, title, excluded }) => ({ itemId, key, title, excluded })) }))
  const recent = batches.filter(batch => open.includes(String(batch.state))).concat(batches.filter(batch => !open.includes(String(batch.state))).slice(-20))
  const batched = new Set(batches.filter(batch => open.includes(String(batch.state))).flatMap(batch => batch.items.map(item => item.itemId)))
  const held = view.workflows.flatMap((definition: WorkflowDefinition) => definition.gates.filter((gate: GraphGate) => gate.kind === 'choose').flatMap(gate => stored.deliveries
    .filter(delivery => delivery.node === `gate:${gate.key}` && delivery.state === 'pending' && !batched.has(String(delivery.item_id)))
    .flatMap(delivery => stored.items.filter(item => item.id === delivery.item_id && item.workflow_id === definition.id))
    .slice(0, 100)
    .map(item => ({ itemId: item.id, workflowId: definition.id, gate: gate.key, key: item.key, title: itemTitle(String(item.key), json(item.payload) as Record<string, unknown>) }))))
  const active = view.workflows.flatMap(definition => definition.nodes.map(node => node.podId))
  return parseWorkflowView({
    ...view,
    gates: { batches: recent, held },
    contracts: Object.fromEntries(view.workflows.flatMap(definition => Object.entries(inspectRows(definition, stored).contracts)).filter(([podId]) => active.includes(podId))),
    graphs: Object.fromEntries(view.workflows.map(definition => [definition.id, projectGraph(definition, stored, undefined, tracedItems)])),
  })
}
