import { descriptionSummary } from '../../contracts/description'
import type { MapEdge, MapGrant, MapPod, MapResource, MapRun, MapSchedule, MapSystem, MapView } from '../../contracts/map-view'
import { approvalURL, parseRunApproval } from '../../contracts/activity'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { PodResource } from '../../contracts/resources'
import { privatePods } from '../central/projection-policy'
import { ItemTagStore } from './item-tags'

type Row = Record<string, unknown>
export const mapWindowMs = 24 * 60 * 60 * 1000
const writes = (method: string) => !['GET', 'HEAD'].includes(method)
const counter = (rows: Row[], key: string, value = 'count'): Record<string, number> => Object.fromEntries(rows.map(row => [String(row[key]), Number(row[value])]))

/**
 * One query answers the map, the list, the KPIs and the detail page. Everything is derived from
 * stored rows of the last 24 hours; `at` is rounded to the minute so an unchanged workspace
 * publishes an unchanged part. The published variant keeps the rights, runs and systems of
 * local-only Pods local, as the central publication does for every other table: their shared-data
 * topology and flows stay, their resources, last runs and system edges are omitted.
 */
export function mapView(store: PodDatabase, now = Date.now(), published = false): MapView {
  const at = Math.floor(now / 60000) * 60000
  const from = at - mapWindowMs
  const db = store.db
  const hidden = new Set(published ? db.prepare(privatePods).all().map(row => row.pod_id as string) : [])
  const tagged = new Map(new ItemTagStore(store).view().map(item => [item.id, { own: item.tags, revision: item.revision }]))
  const tagsOf = (id: string) => tagged.has(id) ? { tags: tagged.get(id)! } : {}
  const descriptions = new Map(db.prepare('SELECT pod_id,body FROM pod_descriptions').all().map(row => [row.pod_id as string, descriptionSummary(row.body as string)]))
  const runsInWindow = counter(db.prepare('SELECT pod_id,count(*) AS count FROM runs WHERE started_at>=? GROUP BY pod_id').all(from), 'pod_id')
  const runTotals = counter(db.prepare('SELECT pod_id,count(*) AS count FROM runs GROUP BY pod_id').all(), 'pod_id')
  // Every failed attempt of the window counts, so a Pod whose last run succeeded still shows how often it failed.
  const failures = counter(db.prepare('SELECT pod_id,count(*) AS count FROM runs WHERE started_at>=? AND state IN (\'failed\',\'interrupted\',\'blocked\') GROUP BY pod_id').all(from), 'pod_id')
  const writesInWindow = counter(db.prepare('SELECT e.pod_id,count(*) AS count FROM effect_ledger e JOIN runs r ON r.id=e.run_id WHERE r.started_at>=? GROUP BY e.pod_id').all(from), 'pod_id')
  // Ascending order lets the most recently started run win for each Pod.
  const lastRuns = new Map(db.prepare('SELECT pod_id,state,started_at,finished_at,summary,error FROM runs ORDER BY started_at,rowid').all().map(row => [row.pod_id as string, run(row)]))
  // A Pod that is running again is still degraded while its last settled run failed or left gaps.
  const settled = new Map(db.prepare('SELECT pod_id,state FROM runs WHERE finished_at IS NOT NULL ORDER BY started_at,rowid').all().map(row => [row.pod_id as string, String(row.state)]))
  const approvals = db.prepare('SELECT r.pod_id,e.run_id,e.data FROM run_events e JOIN runs r ON r.id=e.run_id WHERE r.state=\'running\' AND e.type=\'approval\' AND e.sequence=(SELECT max(newer.sequence) FROM run_events newer WHERE newer.run_id=e.run_id AND newer.type=\'approval\' AND json_extract(newer.data,\'$.grantId\')=json_extract(e.data,\'$.grantId\')) AND json_extract(e.data,\'$.state\')=\'pending\' ORDER BY e.at').all()
  // Grants a Pod requested at the IdP (for example through MCP) wait there for the owner even when no run waits for them.
  const pendingGrants = db.prepare('SELECT id,pod_id,issuer,display FROM pod_grants WHERE state=\'pending\' ORDER BY created_at,rowid').all()
  const schedules = new Map(db.prepare('SELECT pod_id,spec,enabled,next_at FROM schedules').all().map(row => [row.pod_id as string, { spec: JSON.parse(row.spec as string), enabled: row.enabled === 1, nextAt: row.next_at === null ? null : Number(row.next_at) } satisfies MapSchedule]))
  const manifests = new Map(db.prepare('SELECT p.id,s.manifest FROM pods p JOIN scripts s ON s.pod_id=p.id AND s.hash=p.active_script').all().map(row => [row.id as string, parseManifest(JSON.parse(row.manifest as string))]))

  const systems = new Map<string, MapSystem & { methods?: Set<string> }>()
  const edges: MapEdge[] = []
  const pods: MapPod[] = []
  const namespaces = db.prepare('SELECT path,writer FROM data_namespaces ORDER BY path').all()
  const readers = db.prepare('SELECT path,pod_id FROM data_readers ORDER BY path,pod_id').all()
  const flows = counter(db.prepare('SELECT namespace,count(*) AS count FROM data_entries WHERE updated_at>=? GROUP BY namespace').all(from), 'namespace')
  for (const namespace of namespaces) {
    if (namespace.writer === 'owner') continue
    for (const reader of readers.filter(row => row.path === namespace.path)) edges.push({ from: String(namespace.writer), to: String(reader.pod_id), type: 'data', channel: String(namespace.path), flow: flows[String(namespace.path)] ?? 0 })
  }
  const pending = counter(db.prepare(`SELECT n.writer AS pod_id,count(*) AS count FROM work_items i JOIN work_operations o ON o.operation=i.operation JOIN data_namespaces n ON n.path=o.output WHERE i.state IN ('ready','retry_wait') AND i.ready_at<=? GROUP BY n.writer`).all(now), 'pod_id')
  const held = counter(db.prepare(`SELECT n.writer AS pod_id,count(*) AS count FROM work_items i JOIN work_operations o ON o.operation=i.operation JOIN data_namespaces n ON n.path=o.output WHERE i.state IN ('blocked','unknown') GROUP BY n.writer`).all(), 'pod_id')
  const questions = db.prepare('SELECT pod_id,count(*) AS count FROM owner_questions WHERE state=\'pending\' GROUP BY pod_id').all()
  // Only requested and uncertain object approvals wait for the owner; collecting ones are not yet at the IdP.
  const waitingApprovals = db.prepare('SELECT pod_id,count(*) AS count FROM action_approvals WHERE state IN (\'requested\',\'unknown\') GROUP BY pod_id').all()

  for (const pod of store.listPods()) {
    const local = !hidden.has(pod.id)
    const resources = local ? db.prepare('SELECT * FROM resources WHERE pod_id=? AND state=\'ready\' ORDER BY rowid').all(pod.id).map(row => ({ kind: row.kind, name: row.name, configuration: JSON.parse(row.configuration as string) }) as Pick<PodResource, 'kind' | 'name' | 'configuration'>) : []
    const capabilities = manifests.get(pod.id)?.capabilities ?? []
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
        // The Pod's current grants for this program, recorded apart from the sandbox entry.
        const grants = db.prepare('SELECT details FROM pod_grants WHERE pod_id=? AND cli_id=? AND state IN (\'pending\',\'approved\') ORDER BY created_at').all(pod.id, String(item.cliId)).flatMap(row => JSON.parse(row.details as string) as { permission: string, display: string }[])
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
    const writesData = namespaces.filter(row => row.writer === pod.id).map(row => String(row.path))
    const readsData = readers.filter(row => row.pod_id === pod.id).map(row => String(row.path))
    const kind = writesData.length && !manifests.get(pod.id)?.work?.length ? 'source' : ai ? 'decision' : effect ? 'effect' : 'code'
    const runApprovals = approvals.filter(row => local && row.pod_id === pod.id).map((row) => {
      const approval = parseRunApproval(JSON.parse(row.data as string))
      return { grantId: approval.grantId, title: approval.title, runId: String(row.run_id) }
    })
    const waitingGrants = pendingGrants.filter(row => local && row.pod_id === pod.id && !runApprovals.some(approval => approval.grantId === row.id)).map(grant)
    pods.push({
      id: pod.id,
      name: pod.name,
      revision: pod.revision,
      script: pod.activeScript,
      description: descriptions.get(pod.id) || null,
      lifecycle: pod.lifecycle,
      draft: pod.activeScript === null,
      kind,
      ai,
      data: { writes: writesData, reads: readsData },
      work: { pending: pending[pod.id] ?? 0, held: held[pod.id] ?? 0 },
      resources: mapped,
      secrets,
      schedule: schedules.get(pod.id) ?? null,
      lastRun: local ? lastRuns.get(pod.id) ?? null : null,
      runs: local ? runTotals[pod.id] ?? 0 : 0,
      // Neutral values for relays and renderers before issue 1518, which require these fields.
      queue: { blocked: 0, error: null },
      unknown: [],
      approvals: runApprovals,
      grants: waitingGrants,
      failures: local ? failures[pod.id] ?? 0 : 0,
      ...tagsOf(pod.id),
    })
  }

  const active = pods.filter(pod => pod.lifecycle === 'active' && pod.schedule?.enabled).length
  const degraded = pods.filter(pod => pod.lifecycle !== 'archived' && !hidden.has(pod.id) && ['failed', 'completedWithGaps'].includes(settled.get(pod.id) ?? '')).map(pod => ({ podId: pod.id, reason: settled.get(pod.id)! }))
  const name = (podId: unknown) => pods.find(pod => pod.id === podId)?.name ?? String(podId)
  const decisions: MapView['kpis']['decisions'] = [
    ...questions.map(row => ({ podId: String(row.pod_id), kind: 'question' as const, title: name(row.pod_id), count: Number(row.count) })),
    ...waitingApprovals.map(row => ({ podId: String(row.pod_id), kind: 'approval' as const, title: name(row.pod_id), count: Number(row.count) })),
  ]
  return {
    at,
    window: { from, to: at },
    // unknownDeliveries stays 0 for relays and renderers before issue 1518, which require it.
    kpis: { active, paused: pods.length - active, degraded, decisions, unknownDeliveries: 0 },
    systems: Array.from(systems.values(), ({ methods, ...item }) => ({ ...item, how: methods ? [...methods].sort().join(', ') : item.how })),
    pods,
    edges,
  }
}

function grant(row: Row): MapGrant {
  const title = String(row.display)
  return { grantId: String(row.id), title, url: approvalURL({ grantId: String(row.id), issuer: String(row.issuer), state: 'pending', title }) }
}

function run(row: Row): MapRun {
  return { at: Number(row.finished_at ?? row.started_at), state: String(row.state), summary: String(row.summary ?? ''), error: row.error === null || row.error === undefined ? null : String(row.error) }
}

/** The same origin, program and account, folder or host used by several Pods is one node. */
function system(systems: Map<string, MapSystem & { methods?: Set<string> }>, id: string, kind: MapSystem['kind'], name: string, how: string, methods?: string[]): string {
  const existing = systems.get(id)
  if (existing) { for (const method of methods ?? []) existing.methods?.add(method); return id }
  systems.set(id, { id, kind, name, how, ...(methods ? { methods: new Set(methods) } : {}) })
  return id
}
