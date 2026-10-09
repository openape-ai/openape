// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { networkPublicationTables } from '../../src/worker/central/network-projection'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { seedNetwork } from './network-fixture'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

// A schema-42 profile as the last build with workflows left it: two remaining workflows (sequence and channels), an earlier converted one, a network and standalone Pods.
function schema42() {
  const root = mkdtempSync(join(tmpdir(), 'pods-workflow-retirement-')); roots.push(root)
  const store = new PodDatabase(root)
  const network = seedNetwork(store)
  const pod = (name: string, lifecycle: 'active' | 'paused' = 'active') => { const created = store.createPod({ name }); store.db.prepare('UPDATE pods SET lifecycle=? WHERE id=?').run(lifecycle, created.id); return created.id }
  const scheduled = pod('Mail check'); const briefing = pod('Calendar bot'); const editorial = pod('Editorial')
  const intake = pod('Intake', 'paused'); const triage = pod('Triage', 'paused')
  const standalone = pod('PR monitor'); const converted = pod('Converted member')
  const schedule = (podId: string, enabled: boolean) => store.db.prepare('INSERT INTO schedules VALUES(?,1,?,?,1,NULL)').run(podId, JSON.stringify({ kind: 'interval', seconds: 60 }), Number(enabled))
  schedule(scheduled, true); schedule(briefing, false); schedule(standalone, true)
  const workflow = (name: string, mode: 'sequence' | 'channels', members: string[], state: { enabled: number, paused: number, archived: number }) => {
    const id = randomUUID()
    store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,archived,mode) VALUES(?,2,?,?,NULL,?,?,?,?)').run(id, name, JSON.stringify(members.map(podId => ({ podId, after: [], handoff: false }))), state.enabled, state.paused, state.archived, mode)
    for (const podId of members) store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(id, podId)
    return id
  }
  const morning = workflow('Morning briefing', 'sequence', [scheduled, briefing, editorial], { enabled: 1, paused: 0, archived: 0 })
  workflow('Mail management', 'channels', [intake, triage, network.pod.id], { enabled: 0, paused: 1, archived: 0 })
  workflow('Converted earlier', 'channels', [converted], { enabled: 0, paused: 1, archived: 1 })
  // The sequence workflow is mid-run: one node finished with a run, the next is reserved.
  const workflowRun = randomUUID(); const runId = randomUUID()
  store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,started_at) VALUES(?,?,2,\'{}\',\'schedule\',\'running\',1)').run(workflowRun, morning)
  store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'completed\',1,2,\'Synthetic briefing\',NULL,0,1)').run(runId, briefing, network.hash)
  store.db.prepare('INSERT INTO workflow_nodes VALUES(?,?,?,1,0,\'completed\',?,NULL,NULL)').run(workflowRun, briefing, network.hash, runId)
  store.db.prepare('INSERT INTO workflow_attempts VALUES(?,?,?)').run(runId, workflowRun, briefing)
  store.db.prepare('INSERT INTO workflow_reservations VALUES(?,?)').run(editorial, workflowRun)
  store.db.prepare('UPDATE network_scheduler_state SET next_domain=2,last_error_domain=1,last_error=\'Workflow tick failed\'').run()
  store.db.exec('PRAGMA user_version=42')
  return { store, root, network, morning, workflowRun, runId, pods: { scheduled, briefing, editorial, intake, triage, standalone, converted } }
}

const table = (database: PodDatabase | DatabaseSync, sql: string) => ('db' in database ? database.db : database).prepare(sql).all()

it('archives every remaining workflow and only the Pods that just workflows used, and detaches their history', () => {
  const f = schema42()
  const untouched = ['SELECT * FROM networks', 'SELECT * FROM network_members', 'SELECT * FROM network_checkpoints', 'SELECT * FROM schedules', 'SELECT * FROM runs', 'SELECT * FROM graph_items']
  const before = untouched.map(sql => table(f.store, sql))
  const pods = new Map(f.store.listPods().map(pod => [pod.id, pod]))
  f.store.close()

  const store = new PodDatabase(f.root); stores.push(store)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  const lifecycle = Object.fromEntries(Object.entries(f.pods).map(([name, id]) => [name, store.getPod(id).lifecycle]))
  expect(lifecycle).toEqual({ scheduled: 'active', briefing: 'archived', editorial: 'archived', intake: 'archived', triage: 'archived', standalone: 'active', converted: 'active' })
  expect(store.getPod(f.network.pod.id).lifecycle).toBe(pods.get(f.network.pod.id)!.lifecycle)
  for (const [name, id] of Object.entries(f.pods)) expect(store.getPod(id).revision, name).toBe(pods.get(id)!.revision + (lifecycle[name] === 'archived' ? 1 : 0))

  expect(table(store, 'SELECT name,enabled,paused,archived FROM workflows ORDER BY rowid')).toEqual([
    { name: 'Morning briefing', enabled: 0, paused: 1, archived: 1 },
    { name: 'Mail management', enabled: 0, paused: 1, archived: 1 },
    { name: 'Converted earlier', enabled: 0, paused: 1, archived: 1 },
  ])
  expect(store.db.prepare('SELECT state,finished_at IS NOT NULL AS finished FROM workflow_runs').get()).toEqual({ state: 'cancelled', finished: 1 })
  for (const name of ['workflow_members', 'workflow_nodes', 'workflow_attempts', 'workflow_reservations']) expect(table(store, `SELECT * FROM ${name}`), name).toEqual([])
  expect(untouched.map(sql => table(store, sql))).toEqual(before)
  expect(store.db.prepare('SELECT next_domain,last_error_domain,last_error FROM network_scheduler_state').get()).toEqual({ next_domain: 0, last_error_domain: null, last_error: null })
  expect(table(store, 'PRAGMA foreign_key_check')).toEqual([])

  // The verified pre-upgrade copy keeps every workflow row for M8 and for a rollback.
  const [backup] = readdirSync(f.root).filter(file => file.startsWith('before-v42-'))
  const saved = new DatabaseSync(join(f.root, backup!), { readOnly: true })
  try {
    expect(table(saved, 'SELECT count(*) AS count FROM workflow_members')).toEqual([{ count: 7 }])
    expect(table(saved, 'SELECT workflow_run_id FROM workflow_attempts')).toEqual([{ workflow_run_id: f.workflowRun }])
  }
  finally { saved.close() }
})

it('keeps Pods out of central publication that were private through a network workflow call', () => {
  const f = schema42()
  // A network called a workflow; one member keeps its own enabled schedule and stays active after the upgrade.
  const called = f.store.createPod({ name: 'Called with schedule' }).id; const helper = f.store.createPod({ name: 'Called only' }).id
  f.store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id IN (?,?)').run(called, helper)
  f.store.db.prepare('INSERT INTO schedules VALUES(?,1,?,1,1,NULL)').run(called, JSON.stringify({ kind: 'interval', seconds: 60 }))
  const workflowId = randomUUID(); const hash = 'a'.repeat(64)
  f.store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused,archived,mode) VALUES(?,2,\'Called by network\',?,NULL,0,1,0,\'sequence\')').run(workflowId, JSON.stringify([called, helper].map(podId => ({ podId, after: [], handoff: false }))))
  for (const podId of [called, helper]) f.store.db.prepare('INSERT INTO workflow_members VALUES(?,?)').run(workflowId, podId)
  f.store.db.prepare('INSERT INTO workflow_revisions VALUES(?,2,\'{}\',?,1)').run(workflowId, hash)
  f.store.db.prepare('INSERT INTO workflow_call_requests(id,caller_run_id,network_id,network_revision,case_id,case_revision,workflow_id,workflow_revision,request_hash,request,state,created_at) VALUES(?,?,?,1,?,1,?,2,?,\'{}\',\'completed\',1)').run(randomUUID(), f.network.runId, f.network.networkId, f.network.caseId, workflowId, hash)
  const schema42Private = `SELECT pod_id FROM network_members UNION SELECT pod_id FROM network_invocations UNION SELECT m.pod_id FROM workflow_members m JOIN workflow_call_requests c ON c.workflow_id=m.workflow_id`
  const privateBefore = new Set(table(f.store, schema42Private).map(row => String(row.pod_id)))
  expect([called, helper].every(id => privateBefore.has(id))).toBe(true)
  f.store.close()

  const store = new PodDatabase(f.root); stores.push(store)
  expect([store.getPod(called).lifecycle, store.getPod(helper).lifecycle]).toEqual(['active', 'archived'])
  const published = networkPublicationTables(store)
  const publishedPods = new Set(published.pods!.map(row => row.id))
  for (const id of [...privateBefore, called, helper, f.pods.briefing, f.pods.intake]) expect(publishedPods.has(id), id).toBe(false)
  expect(published.schedules!.some(row => row.pod_id === called)).toBe(false)
  expect(publishedPods.has(f.pods.standalone)).toBe(true)
})
