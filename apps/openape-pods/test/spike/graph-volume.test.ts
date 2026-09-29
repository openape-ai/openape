// @vitest-environment node
// Throwaway spike for issue 1407 (plan M0, Spike B). Removed in the final commit.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { centralTables } from '../../src/contracts/central'
import { encodeParts, manifestDigest, splitSnapshot } from '../../src/contracts/central-parts'
import { partBatches } from '../../src/main/central/controller'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { CentralProjection } from '../../src/worker/central/projection'
import { MasterControl } from '../../src/worker/master/control'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { PodDatabase } from '../../src/worker/storage/database'
import { ScriptWorkspace } from '../../src/worker/workspace/scripts'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent' } }))

const graphTables = ['graph_items', 'graph_deliveries', 'graph_item_events']
;(centralTables as unknown as string[]).push(...graphTables)

const schema = `
CREATE TABLE graph_items(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, key TEXT NOT NULL, channel TEXT NOT NULL, node TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX graph_items_key ON graph_items(workflow_id, key);
CREATE TABLE graph_deliveries(item_id TEXT NOT NULL, node TEXT NOT NULL, state TEXT NOT NULL, workflow_run_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(item_id, node));
CREATE INDEX graph_deliveries_pending ON graph_deliveries(node, state);
CREATE TABLE graph_item_events(id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, key TEXT NOT NULL, node TEXT NOT NULL, outcome TEXT NOT NULL, channel TEXT, reason TEXT, confidence REAL, at INTEGER NOT NULL);
CREATE INDEX graph_item_events_key ON graph_item_events(workflow_id, key, id);`

const itemCount = 500
const nodeCount = 5

function fileBytes(root: string): number {
  return ['control.sqlite', 'control.sqlite-wal'].reduce((total, name) => total + (existsSync(join(root, name)) ? statSync(join(root, name)).size : 0), 0)
}

function payload(bytes: number, index: number): string {
  const base = { messageId: `AAMkAGI2${String(index).padStart(8, '0')}`, version: 'CQAAABYAAAB', sender: `sender${index}@example.com`, subject: `Subject ${index}` }
  const filler = Math.max(0, bytes - JSON.stringify({ ...base, filler: '' }).length)
  return JSON.stringify({ ...base, filler: 'x'.repeat(filler) })
}

function measure(payloadBytes: number, reasonBytes: number) {
  const root = mkdtempSync(join(tmpdir(), 'pods-graph-volume-'))
  const store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, () => {})
  const runtime = {} as AgentRuntime
  const runs = new RunDispatcher(store, resources, runtime)
  const scheduler = new Scheduler(store, runs)
  const scripts = new ScriptWorkspace(store, resources, new MasterControl(store, resources, runs, scheduler, runtime))
  const projection = new CentralProjection(store, resources, scripts, runs, scheduler)
  const owner = { issuer: 'https://owner.example', subject: 'owner' }
  const nodes = Array.from({ length: nodeCount }, (_, index) => store.createPod({ name: `Node ${index + 1}` }).id)
  for (const id of nodes) store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(id, JSON.stringify(owner), randomUUID(), randomUUID(), 'ready', '{}')
  store.db.exec(schema)
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const bytesBefore = fileBytes(root)
  const before = encodeParts(splitSnapshot(projection.snapshot(owner)))

  const workflowId = randomUUID()
  const workflowRunId = randomUUID()
  const insertItem = store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,?)')
  const insertDelivery = store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,?,?,?)')
  const finishDelivery = store.db.prepare('UPDATE graph_deliveries SET state=?, workflow_run_id=?, updated_at=? WHERE item_id=? AND node=?')
  const insertEvent = store.db.prepare('INSERT INTO graph_item_events(workflow_id, workflow_run_id, key, node, outcome, channel, reason, confidence, at) VALUES(?,?,?,?,?,?,?,?,?)')
  const reason = 'r'.repeat(reasonBytes)
  const started = performance.now()
  let inbox: string[] = []
  for (const [position, node] of nodes.entries()) {
    const produced: string[] = []
    // One transaction per emit mirrors the dispatcher committing each operation on its own.
    for (let index = 0; index < itemCount; index++) {
      store.transaction(() => {
        const consumed = inbox[index]
        if (consumed) finishDelivery.run('done', workflowRunId, Date.now(), consumed, node)
        const next = nodes[position + 1]
        const channel = next ? `stage.${position + 1}` : null
        insertEvent.run(workflowId, workflowRunId, `mail-${index}`, node, next ? 'emitted' : 'consumed', channel, reason, 0.9, Date.now())
        if (!next || !channel) return
        const id = randomUUID()
        insertItem.run(id, workflowId, workflowRunId, `mail-${index}`, channel, node, payload(payloadBytes, index), Date.now())
        insertDelivery.run(id, next, 'pending', null, Date.now())
        produced.push(id)
      })
    }
    inbox = produced
  }
  const runMs = performance.now() - started
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const bytesAfter = fileBytes(root)

  const snapshotStarted = performance.now()
  const snapshot = projection.snapshot(owner)
  const parts = encodeParts(splitSnapshot(snapshot))
  const snapshotMs = performance.now() - snapshotStarted
  const manifest = Object.fromEntries(Array.from(parts, ([key, part]) => [key, part.hash]))
  const changes: Record<string, string | null> = {}
  const uploads: Record<string, unknown> = {}
  for (const [key, part] of parts) {
    if (before.get(key)?.hash === part.hash) continue
    changes[key] = part.hash
    uploads[part.hash] = JSON.parse(part.text)
  }
  const batches = partBatches(uploads)
  const publication = { type: 'publish', format: 2, id: randomUUID(), revision: 1, hash: manifestDigest(manifest), changes }
  const publicationBytes = batches.reduce((total, batch) => total + JSON.stringify(batch).length, JSON.stringify(publication).length)
  const count = (table: string) => (store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count
  const rows = { items: count('graph_items'), deliveries: count('graph_deliveries'), events: count('graph_item_events') }
  store.close()
  rmSync(root, { recursive: true, force: true })
  return {
    payloadBytes,
    reasonBytes,
    ...rows,
    databaseGrowthKiB: Math.round((bytesAfter - bytesBefore) / 1024),
    publicationKiB: Math.round(publicationBytes / 1024),
    fullSnapshotKiB: Math.round(Buffer.byteLength(JSON.stringify(snapshot)) / 1024),
    changedParts: Object.keys(changes).length,
    batches: batches.length,
    runMs: Math.round(runMs),
    snapshotMs: Math.round(snapshotMs),
  }
}

it('measures 500 items through 5 nodes', () => {
  const results = [measure(300, 80), measure(1024, 200), measure(2048, 500), measure(8192, 500)]
  process.stdout.write(`${JSON.stringify(results, null, 1)}\n`)
  expect(results.every(result => result.items === itemCount * (nodeCount - 1))).toBe(true)
}, 600000)
