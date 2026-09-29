// @vitest-environment node
// Temporary verification for issue 1407 (plan M7): publication size of the M0 volume fixture.
// Introduced in the penultimate commit of M7 and removed in the final one.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { centralMaxBytes } from '../../src/contracts/central'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { CentralProjection } from '../../src/worker/central/projection'
import { MasterControl } from '../../src/worker/master/control'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { PodDatabase } from '../../src/worker/storage/database'
import { pruneItems } from '../../src/worker/workflows/items'
import { ScriptWorkspace } from '../../src/worker/workspace/scripts'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent' } }))

function payload(index: number): string {
  const base = { id: `AAMkAGI2${String(index).padStart(8, '0')}`, version: 'CQAAABYAAAB', sender: `sender${index}@example.com`, subject: `Subject ${index}` }
  return JSON.stringify({ ...base, filler: 'x'.repeat(1024 - JSON.stringify({ ...base, filler: '' }).length) })
}

it('publishes the volume fixture (500 items through 5 nodes, five runs, retention applied) below the snapshot limit', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-graph-volume-'))
  const store = new PodDatabase(root)
  try {
    const resources = new ResourceRegistry(store, () => {}); const runtime = {} as AgentRuntime
    const runs = new RunDispatcher(store, resources, runtime); const scheduler = new Scheduler(store, runs)
    const projection = new CentralProjection(store, resources, new ScriptWorkspace(store, resources, new MasterControl(store, resources, runs, scheduler, runtime)), runs, scheduler)
    const owner = { issuer: 'https://owner.example', subject: 'owner' }
    const nodes = Array.from({ length: 5 }, (_, index) => store.createPod({ name: `Node ${index + 1}` }).id)
    for (const id of nodes) store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(id, JSON.stringify(owner), randomUUID(), randomUUID(), 'ready', '{}')
    const size = () => Buffer.byteLength(JSON.stringify(projection.snapshot(owner)))
    const empty = size()
    const workflowId = randomUUID(); const definition = JSON.stringify({ nodes: nodes.map(podId => ({ podId, after: [], handoff: false })) })
    store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,next_at,mail,mode,group_id) VALUES(?,1,?,?,NULL,0,NULL,NULL,\'channels\',NULL)').run(workflowId, 'Volume', JSON.parse(definition).nodes ? JSON.stringify(JSON.parse(definition).nodes) : '[]')
    const reason = 'r'.repeat(200)
    store.transaction(() => {
      for (let run = 0; run < 5; run++) {
        const runId = randomUUID()
        store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,reason,started_at,finished_at) VALUES(?,?,1,?,\'manual\',\'completed\',NULL,?,?)').run(runId, workflowId, definition, 1000 + run, 2000 + run)
        for (const [position, node] of nodes.entries()) {
          for (let index = 0; index < 500; index++) {
            const key = `run-${run}-mail-${index}`
            if (position) store.db.prepare('INSERT INTO graph_item_events(workflow_id,workflow_run_id,key,node,outcome,channel,reason,confidence,at) VALUES(?,?,?,?,\'consumed\',?,NULL,NULL,?)').run(workflowId, runId, key, node, `stage.${position}`, 1)
            const next = nodes[position + 1]
            if (!next) continue
            const id = randomUUID()
            store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,?)').run(id, workflowId, runId, key, `stage.${position + 1}`, node, payload(index), 1)
            store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,\'done\',?,?)').run(id, next, runId, 1)
            store.db.prepare('INSERT INTO graph_item_events(workflow_id,workflow_run_id,key,node,outcome,channel,reason,confidence,at) VALUES(?,?,?,?,\'emitted\',?,?,0.9,?)').run(workflowId, runId, key, node, `stage.${position + 1}`, reason, 1)
          }
        }
      }
    })
    const count = (table: string) => store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count
    expect([count('graph_items'), count('graph_deliveries'), count('graph_item_events')]).toEqual([10000, 10000, 20000])
    const unpruned = size()
    pruneItems(store)
    expect([count('graph_items'), count('graph_deliveries'), count('graph_item_events')]).toEqual([6000, 6000, 12000])
    const retained = size()
    console.info(JSON.stringify({ emptyMiB: +(empty / 1048576).toFixed(2), fiveRunsMiB: +(unpruned / 1048576).toFixed(2), retainedThreeRunsMiB: +(retained / 1048576).toFixed(2), perRunMiB: +((retained - empty) / 3 / 1048576).toFixed(2), limitMiB: centralMaxBytes / 1048576 }))
    expect(retained).toBeLessThan(centralMaxBytes)
    expect((retained - empty) / 3).toBeLessThan(4.5 * 1048576)
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
}, 60000)
