import { deriveEdges, diagnoseGraph, parseGraphContract } from './graphs'
import type { GraphContract, GraphDetail, GraphDiagnostic, GraphEdge, GraphGate, GraphMemberFacts, GraphNodeKind, GraphRight, GraphTraceEvent } from './graphs'
import type { WorkflowDefinition } from './workflows'

type Row = Record<string, unknown>
/**
 * The stored rows a graph picture is derived from. The desktop reads them from its database, the
 * relay from the published tables, and both derive the same picture with the functions below.
 */
export interface GraphRows { pods: Row[], scripts: Row[], resources: Row[], memberships: Row[], members: Row[], workflows: Row[], variables: Row[], runs: Row[], items: Row[], deliveries: Row[], events: Row[] }
export const graphRowTables = { pods: 'pods', scripts: 'scripts', resources: 'resources', memberships: 'pod_memberships', members: 'workflow_members', workflows: 'workflows', variables: 'pod_variables', runs: 'workflow_runs', items: 'graph_items', deliveries: 'graph_deliveries', events: 'graph_item_events' } as const satisfies Record<keyof GraphRows, string>

const writes = (method: string) => !['GET', 'HEAD'].includes(method)
const text = (value: unknown) => typeof value === 'string' ? value : ''
/** Mail content is data: the title is shortened, single-line text and nothing else. */
export function itemTitle(key: string, data: Record<string, unknown>): string {
  const parts = [data.subject, data.sender].filter((part): part is string => typeof part === 'string' && !!part.trim())
  // eslint-disable-next-line no-control-regex
  return (parts.length ? parts.join(' · ') : key).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, 120)
}
function configuration(row: Row): { type?: string, cliId?: string, access?: string, path?: string, origin?: string, methods?: string[], capability?: string } {
  return typeof row.configuration === 'string' ? JSON.parse(row.configuration) : {}
}
function manifest(rows: GraphRows, podId: string, hash: unknown): { contract?: unknown, capabilities?: string[] } {
  const row = rows.scripts.find(item => item.pod_id === podId && item.hash === hash)
  return row ? JSON.parse(text(row.manifest)) : {}
}
export function contractOf(rows: GraphRows, podId: string, hash: unknown): GraphContract | null {
  const { contract } = manifest(rows, podId, hash)
  return contract === undefined ? null : parseGraphContract(contract)
}
const ready = (rows: GraphRows, podId: string) => rows.resources.filter(row => row.pod_id === podId && row.state === 'ready')

/** Rights with a fixed label and the name, path or origin they apply to. Never a value or a secret. */
function rights(rows: GraphRows, podId: string): GraphRight[] {
  return ready(rows, podId).flatMap((row): GraphRight[] => {
    const item = configuration(row); const name = text(row.name)
    if (row.kind === 'directory') return [{ label: item.access === 'readWrite' ? 'Folder, read and write' : 'Folder, read only', target: item.path ?? name }]
    if (item.type === 'program') return [{ label: item.cliId === 'pods-mail' ? 'Move approved mail' : 'Program, read only', target: item.cliId ?? name }]
    if (item.type === 'http') return [{ label: (item.methods ?? []).some(writes) ? 'HTTP, read and write' : 'HTTP, read only', target: item.origin ?? name }]
    if (item.capability === 'jev.evaluate') return [{ label: 'Jev decisions', target: '' }]
    if (item.capability === 'mail.read') return [{ label: 'Mail, read only', target: '' }]
    return []
  })
}

export interface GraphInspection { contracts: Record<string, GraphContract | null>, edges: GraphEdge[], nodeKinds: Record<string, GraphNodeKind>, diagnostics: GraphDiagnostic[] }
/** Contracts, derived edges, node kinds and diagnostics of a graph against the active scripts and rights of its members. */
export function inspectRows(definition: WorkflowDefinition, rows: GraphRows): GraphInspection {
  const contracts: Record<string, GraphContract | null> = {}; const facts: Record<string, GraphMemberFacts> = {}
  const gates: GraphGate[] = definition.gates ?? []
  const nodeKinds: Record<string, GraphNodeKind> = Object.fromEntries(gates.map(gate => [`gate:${gate.key}`, 'gate']))
  const archived = new Set(rows.workflows.filter(row => row.archived === 1).map(row => row.id))
  for (const { podId } of definition.nodes) {
    const active = rows.pods.find(row => row.id === podId)?.active_script ?? null
    contracts[podId] = contractOf(rows, podId, active)
    const held = ready(rows, podId).map(row => ({ kind: row.kind, ...configuration(row) }))
    const effect = held.some(right => right.cliId === 'pods-mail' || (right.kind === 'directory' && right.access === 'readWrite') || (right.type === 'http' && (right.methods ?? []).some(writes)))
    nodeKinds[podId] = effect ? 'effect' : manifest(rows, podId, active).capabilities?.includes('jev.evaluate') ? 'decision' : 'code'
    const group = rows.memberships.find(row => row.pod_id === podId)?.group_id ?? null
    facts[podId] = {
      archive: held.some(right => right.kind === 'tool' && right.cliId === 'pods-mail'),
      elsewhere: group !== definition.groupId || rows.members.some(row => row.pod_id === podId && row.workflow_id !== definition.id && !archived.has(row.workflow_id)),
      variables: rows.variables.filter(row => row.pod_id === podId).map(row => text(row.name)),
    }
  }
  const members = definition.nodes.flatMap(({ podId }) => contracts[podId] ? [{ podId, contract: contracts[podId] }] : [])
  return { contracts, edges: deriveEdges(members, gates), nodeKinds, diagnostics: diagnoseGraph(definition, contracts, facts) }
}

/** The picture of one graph: what the view shows beyond the saved definition, and the trace of one item when asked. */
export function projectGraph(definition: WorkflowDefinition, rows: GraphRows, key?: string, traces = 0): GraphDetail {
  const inspected = inspectRows(definition, rows)
  const run = rows.runs.filter(row => row.workflow_id === definition.id).reduce<Row | undefined>((latest, row) => !latest || Number(row.started_at) >= Number(latest.started_at) ? row : latest, undefined)
  const items = rows.items.filter(row => row.workflow_id === definition.id)
  const byId = new Map(items.map(row => [row.id, row]))
  const deliveries = rows.deliveries.filter(row => byId.has(row.item_id))
  const counts = new Map<string, { from: string, to: string, channel: string, count: number }>()
  const waiting: Record<string, number> = {}
  for (const delivery of deliveries) {
    const item = byId.get(delivery.item_id)!; const to = text(delivery.node)
    if (delivery.state === 'pending') waiting[to] = (waiting[to] ?? 0) + 1
    if (!run || item.workflow_run_id !== run.id) continue
    const edge = { from: text(item.node), to, channel: text(item.channel) }; const name = JSON.stringify(edge)
    counts.set(name, { ...edge, count: (counts.get(name)?.count ?? 0) + 1 })
  }
  const events = rows.events.filter(row => row.workflow_id === definition.id).sort((a, b) => Number(a.id) - Number(b.id))
  const title = (item: string) => itemTitle(item, JSON.parse(text(items.filter(row => row.key === item).at(-1)?.payload) || '{}'))
  const last = new Map(events.map(row => [text(row.key), row]))
  const trace = (item: string): GraphTraceEvent[] => events.filter(row => row.key === item).slice(0, 200).map(row => ({ node: text(row.node), outcome: text(row.outcome), channel: row.channel as string | null, reason: row.reason as string | null, confidence: row.confidence as number | null, at: Number(row.at) }))
  return {
    workflowId: definition.id,
    contracts: inspected.contracts,
    edges: definition.mode === 'channels' ? inspected.edges : definition.nodes.flatMap(node => node.after.map(from => ({ from, to: node.podId, channel: '' }))),
    nodeKinds: inspected.nodeKinds,
    diagnostics: inspected.diagnostics,
    rights: Object.fromEntries(definition.nodes.map(node => [node.podId, rights(rows, node.podId)])),
    lastRun: run ? { id: text(run.id), startedAt: Number(run.started_at), state: text(run.state) } : null,
    counts: [...counts.values()],
    waiting,
    items: [...last.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 100).map(row => ({ key: text(row.key), title: title(text(row.key)), outcome: text(row.outcome), node: text(row.node) })),
    trace: key === undefined ? null : { key, title: title(key), events: trace(key) },
    // A reader without a worker to ask, such as the browser, gets the traces of the most recent items along.
    ...traces ? { traces: Object.fromEntries([...last.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, traces).map(row => [text(row.key), trace(text(row.key))])) } : {},
  }
}
