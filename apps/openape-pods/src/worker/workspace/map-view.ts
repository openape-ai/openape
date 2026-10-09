import { descriptionSummary } from '../../contracts/description'
import { deriveEdges } from '../../contracts/graphs'
import type { GraphContract, GraphGate } from '../../contracts/graphs'
import type { MapAutomation, MapEdge, MapGate, MapPod, MapResource, MapRun, MapSchedule, MapSystem, MapView } from '../../contracts/map-view'
import { parseRunApproval } from '../../contracts/activity'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { PodResource } from '../../contracts/resources'
import { privatePods } from '../central/projection-policy'

type Row = Record<string, unknown>
export const mapWindowMs = 24 * 60 * 60 * 1000
const writes = (method: string) => !['GET', 'HEAD'].includes(method)
const counter = (rows: Row[], key: string, value = 'count'): Record<string, number> => Object.fromEntries(rows.map(row => [String(row[key]), Number(row[value])]))

/**
 * One query answers the map, the list, the KPIs and the detail page. Everything is derived from
 * stored rows of the last 24 hours; `at` is rounded to the minute so an unchanged workspace
 * publishes an unchanged part. The published variant keeps the rights, runs and systems of
 * network members local, as the central publication does for every other table: their channel
 * topology, flows and gates stay, their resources, last runs and system edges are omitted.
 */
const scriptUpdateWindowMs = 7 * 24 * 60 * 60 * 1000

export function mapView(store: PodDatabase, now = Date.now(), published = false): MapView {
  const at = Math.floor(now / 60000) * 60000
  const from = at - mapWindowMs
  const db = store.db
  const hidden = new Set(published ? db.prepare(privatePods).all().map(row => row.pod_id as string) : [])
  const groups = db.prepare('SELECT g.id,g.name,m.pod_id FROM pod_groups g JOIN pod_memberships m ON m.group_id=g.id').all()
  const groupOf = (podId: string) => groups.find(row => row.pod_id === podId)
  const groupName = (id: unknown) => groups.find(row => row.id === id)?.name as string | undefined ?? null
  const descriptions = new Map(db.prepare('SELECT pod_id,body FROM pod_descriptions').all().map(row => [row.pod_id as string, descriptionSummary(row.body as string)]))
  const runsInWindow = counter(db.prepare('SELECT pod_id,count(*) AS count FROM runs WHERE started_at>=? GROUP BY pod_id').all(from), 'pod_id')
  const runTotals = counter(db.prepare('SELECT pod_id,count(*) AS count FROM runs GROUP BY pod_id').all(), 'pod_id')
  const writesInWindow = counter(db.prepare('SELECT e.pod_id,count(*) AS count FROM effect_ledger e JOIN runs r ON r.id=e.run_id WHERE r.started_at>=? GROUP BY e.pod_id').all(from), 'pod_id')
  // Ascending order lets the most recently started run win for each Pod.
  const lastRuns = new Map(db.prepare('SELECT pod_id,state,started_at,finished_at,summary FROM runs ORDER BY started_at,rowid').all().map(row => [row.pod_id as string, run(row)]))
  // A Pod that is running again is still degraded while its last settled run failed or left gaps.
  const settled = new Map(db.prepare('SELECT pod_id,state FROM runs WHERE finished_at IS NOT NULL ORDER BY started_at,rowid').all().map(row => [row.pod_id as string, String(row.state)]))
  const unknownEffects = db.prepare('SELECT pod_id,effect_key,run_id FROM effect_ledger WHERE operation=\'http.request\' AND state=\'unknown\' ORDER BY rowid').all()
  const blocked = db.prepare('SELECT pod_id,count(*) AS count,min(error) AS error FROM accepted_events WHERE state=\'blocked\' GROUP BY pod_id').all()
  const approvals = db.prepare('SELECT r.pod_id,e.run_id,e.data FROM run_events e JOIN runs r ON r.id=e.run_id WHERE r.state=\'running\' AND e.type=\'approval\' AND e.sequence=(SELECT max(newer.sequence) FROM run_events newer WHERE newer.run_id=e.run_id AND newer.type=\'approval\' AND json_extract(newer.data,\'$.grantId\')=json_extract(e.data,\'$.grantId\')) AND json_extract(e.data,\'$.state\')=\'pending\' ORDER BY e.at').all()
  const schedules = new Map(db.prepare('SELECT pod_id,spec,enabled FROM schedules').all().map(row => [row.pod_id as string, { spec: JSON.parse(row.spec as string), enabled: row.enabled === 1 } satisfies MapSchedule]))
  const manifests = new Map(db.prepare('SELECT p.id,s.manifest FROM pods p JOIN scripts s ON s.pod_id=p.id AND s.hash=p.active_script').all().map(row => [row.id as string, parseManifest(JSON.parse(row.manifest as string))]))
  const contractOf = (podId: string): GraphContract | null => (manifests.get(podId)?.contract as GraphContract | undefined) ?? null

  const systems = new Map<string, MapSystem & { methods?: Set<string> }>()
  const edges: MapEdge[] = []
  const pods: MapPod[] = []
  const automationOf = new Map<string, string>()
  const sourceSchedules = new Map<string, MapSchedule>()
  const automations: MapAutomation[] = []

  // Persistent networks: definition from the current revision, flows from accepted events, choices and gate tasks.
  for (const row of db.prepare('SELECT n.id,n.name,n.state,n.group_id,n.revision,r.contract FROM networks n JOIN network_revisions r ON r.network_id=n.id AND r.revision=n.revision ORDER BY n.created_at,n.id').all()) {
    const stored = JSON.parse(row.contract as string) as { members?: { podId: string, contract: GraphContract, source: { schedule: MapSchedule['spec'] } | null }[], routes?: GraphGate[] }
    // A revision written before member contracts were pinned lists its members only in the table.
    const definition = { routes: stored.routes ?? [], members: stored.members ?? db.prepare('SELECT pod_id FROM network_members WHERE network_id=? ORDER BY rowid').all(row.id!).map(member => ({ podId: member.pod_id as string, contract: contractOf(member.pod_id as string) ?? { takes: [], gives: [], summary: '' }, source: null })) }
    const members = definition.members.map(member => member.podId)
    for (const member of members) automationOf.set(member, row.id as string)
    const flows = counter(db.prepare('SELECT channel,count(*) AS count FROM network_events WHERE network_id=? AND accepted_at>=? GROUP BY channel').all(row.id!, from), 'channel')
    const open = counter(db.prepare('SELECT gate_key,count(*) AS count FROM network_choices WHERE network_id=? AND network_revision=? AND decided_at IS NULL GROUP BY gate_key').all(row.id!, row.revision!), 'gate_key')
    const batches = db.prepare('SELECT c.gate_key,t.state,count(*) AS count FROM network_gate_tasks t JOIN network_gate_controls c ON c.task_id=t.id WHERE t.network_id=? AND t.network_revision=? GROUP BY c.gate_key,t.state').all(row.id!, row.revision!)
    const gates = definition.routes.map(gate => mapGate(gate, open[gate.key] ?? 0, counter(batches.filter(batch => batch.gate_key === gate.key), 'state')))
    const source = definition.members.find(member => member.source?.schedule)
    for (const member of definition.members) {
      if (member.source?.schedule) sourceSchedules.set(member.podId, { spec: member.source.schedule, enabled: row.state === 'active' })
    }
    const latest = db.prepare('SELECT r.state,r.started_at,r.finished_at,r.summary FROM network_invocations i JOIN runs r ON r.id=i.run_id WHERE i.network_id=? ORDER BY r.started_at DESC LIMIT 1').get(row.id!)
    automations.push({ id: row.id as string, revision: Number(row.revision), kind: 'network', bounded: false, name: row.name as string, group: groupName(row.group_id), groupId: row.group_id as string, state: row.state as MapAutomation['state'], members, schedule: source ? { spec: source.source!.schedule, enabled: row.state === 'active' } : null, counts: counter(db.prepare('SELECT state,count FROM network_queue_counts WHERE network_id=?').all(row.id!), 'state', 'count'), flows, gates, lastRun: latest && !published ? run(latest) : null })
    for (const edge of deriveEdges(definition.members.map(member => ({ podId: member.podId, contract: member.contract })), definition.routes)) edges.push({ from: edge.from, to: edge.to, type: 'channel', channel: edge.channel, flow: flows[edge.channel] ?? 0 })
  }

  // Workflows: sequence chains hand off along `after`; bounded channel graphs emit along contracts.
  for (const row of db.prepare('SELECT id,revision,name,nodes,schedule,enabled,paused,mode,group_id FROM workflows WHERE archived=0 ORDER BY rowid').all()) {
    const nodes = JSON.parse(row.nodes as string) as { podId: string, after: string[] }[]
    const members = nodes.map(node => node.podId)
    for (const member of members) automationOf.set(member, row.id as string)
    const bounded = row.mode === 'channels'
    const runs = db.prepare('SELECT count(*) AS count FROM workflow_runs WHERE workflow_id=? AND started_at>=?').get(row.id!, from)!.count as number
    const latest = db.prepare('SELECT state,started_at,finished_at,reason AS summary FROM workflow_runs WHERE workflow_id=? ORDER BY started_at DESC LIMIT 1').get(row.id!)
    const flows = bounded ? counter(db.prepare('SELECT channel,count(*) AS count FROM graph_item_events WHERE workflow_id=? AND outcome=\'emitted\' AND at>=? GROUP BY channel').all(row.id!, from), 'channel') : {}
    const gateRows = db.prepare('SELECT definition FROM workflow_gates WHERE workflow_id=? ORDER BY rowid').all(row.id!).map(gate => JSON.parse(gate.definition as string) as GraphGate)
    const gates = gateRows.map(gate => mapGate(gate, Number(db.prepare('SELECT count(*) AS count FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.node=? AND d.state=\'pending\'').get(row.id!, `gate:${gate.key}`)!.count), counter(db.prepare('SELECT state,count(*) AS count FROM graph_gate_batches WHERE workflow_id=? AND gate=? GROUP BY state').all(row.id!, gate.key), 'state')))
    const active = row.enabled === 1 && row.paused === 0
    automations.push({ id: row.id as string, revision: Number(row.revision), kind: bounded ? 'network' : 'chain', bounded, name: row.name as string, group: groupName(row.group_id), groupId: row.group_id as string | null, state: active ? 'active' : 'paused', members, schedule: row.schedule ? { spec: JSON.parse(row.schedule as string), enabled: active } : null, counts: {}, flows, gates, lastRun: latest ? run(latest) : null })
    if (bounded) {
      const contracts = members.flatMap(podId => contractOf(podId) ? [{ podId, contract: contractOf(podId)! }] : [])
      for (const edge of deriveEdges(contracts, gateRows)) edges.push({ from: edge.from, to: edge.to, type: 'channel', channel: edge.channel, flow: flows[edge.channel] ?? 0 })
    }
    else {
      for (const node of nodes) {
        for (const previous of node.after) edges.push({ from: previous, to: node.podId, type: 'channel', channel: 'handoff', flow: runs })
      }
    }
  }

  const scriptUpdates = new Map<string, { at: number, previous: string, script: string }>()
  for (const row of db.prepare('SELECT body,created_at FROM network_trace_events WHERE kind=\'member-script-updated\' AND created_at>=? ORDER BY created_at,id').all(now - scriptUpdateWindowMs)) {
    const body = JSON.parse(row.body as string) as { podId: string, previousScript: string, script: string }
    scriptUpdates.set(body.podId, { at: row.created_at as number, previous: body.previousScript, script: body.script })
  }
  for (const pod of store.listPods()) {
    const local = !hidden.has(pod.id)
    const resources = local ? db.prepare('SELECT * FROM resources WHERE pod_id=? AND state=\'ready\' ORDER BY rowid').all(pod.id).map(row => ({ kind: row.kind, name: row.name, configuration: JSON.parse(row.configuration as string) }) as Pick<PodResource, 'kind' | 'name' | 'configuration'>) : []
    const capabilities = manifests.get(pod.id)?.capabilities ?? []
    const contract = contractOf(pod.id)
    const mapped: MapResource[] = []
    const secrets: string[] = []
    let effect = false
    for (const resource of resources) {
      const item = resource.configuration
      if (resource.kind === 'credential') { secrets.push(String(item.alias)); mapped.push({ kind: 'secret', name: String(item.alias), how: '', system: null }); continue }
      if (resource.kind === 'reference') { mapped.push({ kind: 'reference', name: resource.name, how: '', system: null }); continue }
      if (resource.kind === 'directory') {
        const id = system(systems, `dir:${String(item.path)}`, 'directory', resource.name, String(item.path))
        mapped.push({ kind: 'directory', name: resource.name, how: String(item.access), system: id })
        edges.push({ from: id, to: pod.id, type: 'read', channel: null, flow: runsInWindow[pod.id] ?? 0 })
        if (item.access === 'readWrite') { effect = true; edges.push({ from: pod.id, to: id, type: 'write', channel: null, flow: runsInWindow[pod.id] ?? 0 }) }
        continue
      }
      if (item.type === 'http') {
        const methods = (item.methods as string[]) ?? []
        const id = system(systems, `svc:${String(item.origin)}`, 'service', new URL(String(item.origin)).host, '', methods)
        mapped.push({ kind: 'service', name: String(item.origin), how: methods.join(', '), system: id })
        if (methods.some(method => !writes(method))) edges.push({ from: id, to: pod.id, type: 'read', channel: null, flow: runsInWindow[pod.id] ?? 0 })
        if (methods.some(writes)) { effect = true; edges.push({ from: pod.id, to: id, type: 'write', channel: null, flow: writesInWindow[pod.id] ?? 0 }) }
        continue
      }
      if (item.type === 'jev') {
        const id = system(systems, 'ai:jev', 'service', resource.name, String(item.model))
        mapped.push({ kind: 'service', name: resource.name, how: `${String(item.model)} · ${String(item.maxAttempts)}`, system: id })
        edges.push({ from: id, to: pod.id, type: 'read', channel: null, flow: runsInWindow[pod.id] ?? 0 })
        continue
      }
      if (item.type === 'program') {
        const grants = (item.grants as { permission: string, display: string }[]) ?? []
        const account = grants.map(grant => /account\[email=([^\]*]+)\]/.exec(grant.permission)?.[1]).find(Boolean) ?? null
        const id = system(systems, `app:${String(item.cliId)}:${account ?? '*'}`, 'application', account ?? String(item.name), String(item.cliId))
        mapped.push({ kind: 'application', name: String(item.name), how: grants.map(grant => grant.display).join('; '), system: id })
        edges.push({ from: id, to: pod.id, type: 'read', channel: null, flow: runsInWindow[pod.id] ?? 0 })
        // A granted command whose action is not a read (list, read, get, login) reaches into the application.
        if (item.cliId === 'pods-mail' || grants.some(grant => /#(?!(?:list|read|get|login)$)[a-z-]+$/.test(grant.permission))) { effect = true; edges.push({ from: pod.id, to: id, type: 'write', channel: null, flow: writesInWindow[pod.id] ?? 0 }) }
        continue
      }
      if (item.type === 'sshInventory') {
        const target = item.target as { alias: string }
        const id = system(systems, `ssh:${target.alias}`, 'ssh', target.alias, 'ssh')
        mapped.push({ kind: 'ssh', name: target.alias, how: 'read', system: id })
        edges.push({ from: id, to: pod.id, type: 'read', channel: null, flow: runsInWindow[pod.id] ?? 0 })
      }
    }
    const ai = capabilities.includes('jev.evaluate')
    const kind = contract && !contract.takes.length && contract.gives.length ? 'source' : ai ? 'decision' : effect ? 'effect' : 'code'
    const queue = blocked.find(row => row.pod_id === pod.id)
    const membership = groupOf(pod.id)
    pods.push({
      id: pod.id, name: pod.name, revision: pod.revision, script: pod.activeScript, description: descriptions.get(pod.id) || null, group: membership?.name as string ?? null, groupId: membership?.id as string ?? null, lifecycle: pod.lifecycle, draft: pod.activeScript === null,
      kind, ai, channels: { takes: contract?.takes ?? [], gives: contract?.gives ?? [] }, resources: mapped, secrets,
      schedule: schedules.get(pod.id) ?? sourceSchedules.get(pod.id) ?? null, lastRun: local ? lastRuns.get(pod.id) ?? null : null, runs: local ? runTotals[pod.id] ?? 0 : 0,
      automation: automationOf.get(pod.id) ?? null, queue: local ? { blocked: Number(queue?.count ?? 0), error: (queue?.error as string | null) ?? null } : { blocked: 0, error: null },
      ...(local && scriptUpdates.get(pod.id)?.script === pod.activeScript ? { scriptUpdate: scriptUpdates.get(pod.id) } : {}),
      unknown: unknownEffects.filter(row => local && row.pod_id === pod.id).map(row => ({ key: String(row.effect_key), runId: String(row.run_id) })),
      approvals: approvals.filter(row => local && row.pod_id === pod.id).map(row => parseRunApproval(JSON.parse(row.data as string))).map((approval, index) => ({ grantId: approval.grantId, title: approval.title, runId: String(approvals.filter(row => row.pod_id === pod.id)[index]!.run_id) })),
    })
  }

  const standalone = pods.filter(pod => !pod.automation)
  const active = automations.filter(automation => automation.state === 'active').length + standalone.filter(pod => pod.lifecycle === 'active' && pod.schedule?.enabled).length
  const degraded = pods.filter(pod => pod.lifecycle !== 'archived' && !hidden.has(pod.id) && (pod.queue.blocked > 0 || ['failed', 'completedWithGaps'].includes(settled.get(pod.id) ?? ''))).map(pod => ({ podId: pod.id, reason: pod.queue.blocked > 0 ? pod.queue.error ?? 'blocked' : settled.get(pod.id)! }))
  const decisions: MapView['kpis']['decisions'] = []
  for (const automation of automations) {
    for (const gate of automation.gates) {
      const count = gate.kind === 'choose' ? gate.open : gate.batches.pending ?? 0
      if (count) decisions.push({ networkId: automation.id, gate: gate.key, title: gate.title, kind: gate.kind, count })
    }
  }
  const unknownDeliveries = Number(db.prepare('SELECT count(*) AS count FROM effect_ledger WHERE operation=\'http.request\' AND state=\'unknown\'').get()!.count) + Number(db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE state=\'unknown\'').get()!.count)
  return {
    at, window: { from, to: at },
    kpis: { active, paused: automations.length + standalone.length - active, degraded, decisions, unknownDeliveries },
    systems: Array.from(systems.values(), ({ methods, ...item }) => ({ ...item, how: methods ? [...methods].sort().join(', ') : item.how })),
    pods, automations, edges,
  }
}

function run(row: Row): MapRun {
  return { at: Number(row.finished_at ?? row.started_at), state: String(row.state), summary: String(row.summary ?? '') }
}

function mapGate(gate: GraphGate, open: number, batches: Record<string, number>): MapGate {
  return { key: gate.key, kind: gate.kind, title: gate.title, takes: gate.takes, options: gate.kind === 'choose' ? gate.options : [{ key: 'approve', title: gate.title, channel: gate.gives }], open, batches }
}

/** The same origin, program and account, folder or host used by several Pods is one node. */
function system(systems: Map<string, MapSystem & { methods?: Set<string> }>, id: string, kind: MapSystem['kind'], name: string, how: string, methods?: string[]): string {
  const existing = systems.get(id)
  if (existing) { for (const method of methods ?? []) existing.methods?.add(method); return id }
  systems.set(id, { id, kind, name, how, ...(methods ? { methods: new Set(methods) } : {}) })
  return id
}
