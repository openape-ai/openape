// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
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
