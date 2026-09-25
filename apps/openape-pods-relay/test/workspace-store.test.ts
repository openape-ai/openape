import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CentralSnapshot } from '../../openape-pods/src/contracts/central'
import { parseCentralCommand, parseCentralSnapshot } from '../../openape-pods/src/contracts/central'
import { encodeParts, manifestDigest, splitSnapshot } from '../../openape-pods/src/contracts/central-parts'
import { WorkspaceStore } from '../server/utils/workspace-store'

const cleanup: (() => void)[] = []
afterEach(() => { for (const run of cleanup.splice(0).reverse()) run() })
function snapshot(): CentralSnapshot {
  const pod = { id: randomUUID(), name: 'Monitor', revision: 1, lifecycle: 'paused' as const, activeScript: null }
  return {
    version: 1, workspace: { pods: [pod], organization: { revision: 1, groups: [] } },
    pods: [{ id: pod.id, ready: true, details: { claims: [], counts: { finding: 0, question: 0, gap: 0 }, total: 0, versions: [], checkpointRevision: 0, source: null },
      scripts: { pod, resourceEpoch: 0, credentialAliases: [], versions: [], drafts: [], source: null },
      resources: { resources: [], variables: [], epoch: 0 }, scheduling: { spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 },
      runs: { runs: [], events: [] }, versions: {}, history: {} }],
    archive: { schema: 23, tables: {} }, artifacts: [],
  }
}
function setup(path = ':memory:') {
  let now = 100000
  const store = new WorkspaceStore(path, () => now); cleanup.push(() => store.close())
  const actor = { id: randomUUID(), generation: randomUUID(), owner: { issuer: 'https://owner.example', subject: 'opaque-owner' } }
  const other = { ...actor.owner, subject: 'another-owner' }
  const state = snapshot(); const session = store.begin(actor)
  const publication = store.publish(actor, session.lease, randomUUID(), 0, state)
  store.heartbeat(actor, session.lease, publication.hash)
  return { store, actor, other, state, lease: session.lease, publication, advance: (ms: number) => { now += ms } }
}

it('persists one shared snapshot across restart without exposing another owner or offline content', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pods-workspace-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const { store, actor, other, state, advance } = setup(join(directory, 'workspace.sqlite'))
  const podId = state.pods[0]!.id
  expect(store.read(actor.owner, actor.id, podId).pod).toEqual(state.pods[0])
  expect(store.inventory(other)).toEqual([])
  expect(() => store.read(other, actor.id, podId)).toThrow('workspace_not_found')
  const reopened = new WorkspaceStore(join(directory, 'workspace.sqlite'), store.now); cleanup.push(() => reopened.close())
  expect(reopened.read(actor.owner, actor.id, podId)).toEqual(store.read(actor.owner, actor.id, podId))
  advance(30001)
  expect(() => store.read(actor.owner, actor.id, podId)).toThrow('pod_offline')
  expect(store.inventory(actor.owner)[0]?.workspace.pods[0]).toMatchObject({ name: 'Monitor', online: false, activeScript: null })
  expect(() => store.submit(actor.owner, actor.id, 1, { channel: 'details', body: { type: 'describe', podId, text: 'new', revision: 0 } }, randomUUID())).toThrow('pod_offline')
})

it('commits the command result and updated data atomically, deduplicating retries from both clients', () => {
  const { store, actor, other, state, lease } = setup()
  const command = { channel: 'details' as const, body: { type: 'describe', podId: state.pods[0]!.id, text: 'Saved centrally', revision: 0 } }
  const id = randomUUID()
  expect(store.submit(actor.owner, actor.id, 1, command, id).state).toBe('accepted')
  expect(store.submit(actor.owner, actor.id, 1, command, id).id).toBe(id)
  expect(() => store.operation(other, id)).toThrow('workspace_operation_not_found')
  expect(() => store.submit(actor.owner, actor.id, 1, { ...command, body: { ...command.body, text: 'Changed retry' } }, id)).toThrow('workspace_operation_conflict')
  expect(() => store.submit(actor.owner, actor.id, 1, command, randomUUID())).toThrow('workspace_busy')
  expect(store.claim(actor, lease)?.state).toBe('started')
  expect(store.claim(actor, lease)).toBeNull()
  state.pods[0]!.details.description = { text: 'Saved centrally', revision: 1, state: 'ready', error: null, updatedAt: 100000 }
  const publication = randomUUID(); const completion = { id, result: { saved: true }, error: null }
  const result = store.publish(actor, lease, publication, 1, state, completion)
  expect(result.revision).toBe(2)
  expect(store.operation(actor.owner, id)).toMatchObject({ state: 'applied', revision: 2, result: { saved: true } })
  expect(store.publish(actor, lease, publication, 1, state, completion)).toEqual(result)
  expect(() => store.submit(actor.owner, actor.id, 1, command, randomUUID())).toThrow('workspace_revision_conflict')
  expect(store.read(actor.owner, actor.id, state.pods[0]!.id).pod.details.description?.text).toBe('Saved centrally')
})

it('fences a second executor, expires undelivered commands and never replays uncertain effects', () => {
  const { store, actor, state, lease, advance, publication } = setup()
  expect(() => store.begin(actor)).toThrow('workspace_already_connected')
  const command = { channel: 'runs' as const, body: { type: 'start', podId: state.pods[0]!.id } }
  const id = randomUUID(); store.submit(actor.owner, actor.id, 1, command, id)
  store.claim(actor, lease)
  advance(30001)
  const next = store.begin(actor)
  expect(next.pending).toMatchObject([{ id, state: 'unknown' }])
  expect(() => store.heartbeat(actor, lease, publication.hash)).toThrow('stale_workspace_runtime')
  expect(() => store.publish(actor, next.lease, randomUUID(), 1, state)).toThrow('workspace_operation_unresolved')
  store.publish(actor, next.lease, randomUUID(), 1, state, { id, result: null, error: 'Interrupted; inspect the actual run before another request' })
  store.heartbeat(actor, next.lease, publication.hash)
  const expires = randomUUID(); store.submit(actor.owner, actor.id, 1, command, expires)
  advance(30001); store.heartbeat(actor, next.lease, publication.hash)
  expect(store.claim(actor, next.lease)).toBeNull()
  expect(store.operation(actor.owner, expires).state).toBe('failed')
})

it('checks managed artifact hashes and membership before committing or returning any bytes', () => {
  const { store, actor, other, lease, state } = setup()
  const podId = state.pods[0]!.id; const bytes = Buffer.from('A managed work file')
  const hash = createHash('sha256').update(bytes).digest('hex')
  state.artifacts.push({ podId, path: 'workspace/result.txt', hash, size: bytes.length })
  expect(() => store.publish(actor, lease, randomUUID(), 1, state)).toThrow('workspace_artifact_missing')
  expect(() => store.putArtifact(actor, lease, podId, '0'.repeat(64), bytes)).toThrow('artifact_hash_mismatch')
  store.putArtifact(actor, lease, podId, hash, bytes)
  store.publish(actor, lease, randomUUID(), 1, state)
  expect(Buffer.from(store.artifact(actor.owner, actor.id, podId, 'workspace/result.txt')).toString()).toBe(bytes.toString())
  expect(() => store.artifact(other, actor.id, podId, 'workspace/result.txt')).toThrow('workspace_not_found')
  expect(() => store.artifact(actor.owner, actor.id, podId, '../credentials/key')).toThrow('artifact_not_found')
  state.artifacts[0]!.path = 'workspace/../credentials/key'
  expect(() => store.publish(actor, lease, randomUUID(), 2, state)).toThrow('Invalid managed artifact')
})

it('allows an online paused Pod but refuses a Pod whose own worker is unavailable', () => {
  const { store, actor, lease, state } = setup()
  expect(store.read(actor.owner, actor.id, state.pods[0]!.id).pod.ready).toBe(true)
  state.pods[0]!.ready = false
  store.publish(actor, lease, randomUUID(), 1, state)
  expect(() => store.read(actor.owner, actor.id, state.pods[0]!.id)).toThrow('pod_offline')
})

it('rejects remote secrets, filesystem assignments and arbitrary worker commands', () => {
  const podId = randomUUID()
  for (const command of [
    { channel: 'resources', body: { type: 'saveCredential', podId, alias: 'token', value: 'never-upload', epoch: 0 } },
    { channel: 'resources', body: { type: 'assignDirectory', podId, path: '/', access: 'readWrite', epoch: 0 } },
    { channel: 'serviceCheck', body: {} },
  ]) expect(() => parseCentralCommand(command)).toThrow()
})

it('keeps an accepted edit through an unrelated runtime progress publication', () => {
  const { store, actor, state, lease } = setup()
  const id = randomUUID()
  store.submit(actor.owner, actor.id, 1, { channel: 'details', body: { type: 'describe', podId: state.pods[0]!.id, text: 'Owner edit', revision: 0 } }, id)
  state.pods[0]!.details.checkpointRevision++
  store.publish(actor, lease, randomUUID(), 1, state)
  expect(store.claim(actor, lease)).toMatchObject({ id, state: 'started' })
})

it('denies offline operation payloads and rejects local credential tables in publications', () => {
  const { store, actor, state, lease, advance } = setup()
  const id = randomUUID()
  store.submit(actor.owner, actor.id, 1, { channel: 'details', body: { type: 'describe', podId: state.pods[0]!.id, text: 'Private edit', revision: 0 } }, id)
  advance(30001)
  expect(() => store.visibleOperation(actor.owner, id)).toThrow('pod_offline')
  state.archive.tables.connections = [{ token: 'must-never-be-uploaded' }]
  expect(() => store.publish(actor, lease, randomUUID(), 1, state)).toThrow('Invalid workspace archive')
})

function withRuns(state: CentralSnapshot, count: number): CentralSnapshot {
  const pod = state.pods[0]!
  const runs = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), podId: pod.id, scriptHash: 'a'.repeat(64), state: 'completed' as const, startedAt: index, finishedAt: index + 1, summary: `Run ${index}`, error: null, checkpointRevision: 0, recovery: null }))
  const events = (index: number) => [{ sequence: 1, type: 'log', data: { line: `event ${index}` }, at: index }]
  pod.runs = { runs, events: runs.length ? events(0) : [] }
  pod.history = Object.fromEntries(runs.map((run, index) => [run.id, { runs: [run], events: events(index) }]))
  state.archive.tables.run_events = Array.from({ length: 40 }, (_, index) => ({ id: index }))
  return state
}
function publishV2(store: WorkspaceStore, actor: Parameters<WorkspaceStore['begin']>[0], lease: string, known: Record<string, string>, state: CentralSnapshot, revision: number) {
  const parts = encodeParts(splitSnapshot(state))
  const manifest = Object.fromEntries(Array.from(parts, ([key, part]) => [key, part.hash]))
  const changes: Record<string, string | null> = Object.fromEntries(Object.keys(known).filter(key => !(key in manifest)).map(key => [key, null]))
  const staged: Record<string, unknown> = {}
  for (const [key, part] of parts) {
    if (known[key] !== part.hash) { changes[key] = part.hash; staged[part.hash] = JSON.parse(part.text) }
  }
  store.stage(actor, lease, staged)
  return { changes, staged, manifest, result: store.publishParts(actor, lease, randomUUID(), revision, changes, manifestDigest(manifest)) }
}

it('publishes format 2 as a small delta and serves summaries, pages, single runs and the legacy Pod', () => {
  const { store, actor, lease, state } = setup()
  withRuns(state, 30)
  const first = publishV2(store, actor, lease, {}, state, 1)
  expect(first.result.revision).toBe(2)
  const podId = state.pods[0]!.id
  expect(store.read(actor.owner, actor.id, podId).pod).toEqual(state.pods[0])
  const summary = store.view(actor.owner, actor.id, podId, { view: 'summary' }) as { total: number, pod: CentralSnapshot['pods'][number] }
  expect(summary.total).toBe(30)
  expect(summary.pod.runs.runs).toHaveLength(20)
  expect(summary.pod.history).toEqual({})
  expect(store.view(actor.owner, actor.id, podId, { view: 'runs', offset: 20 })).toMatchObject({ total: 30, runs: state.pods[0]!.runs.runs.slice(20) })
  const runId = state.pods[0]!.runs.runs[5]!.id
  expect(store.view(actor.owner, actor.id, podId, { view: 'run', runId })).toMatchObject({ run: { id: runId }, events: [{ data: { line: 'event 5' } }] })
  expect(() => store.view(actor.owner, actor.id, podId, { view: 'run', runId: randomUUID() })).toThrow('run_not_found')
  expect(store.db.prepare('SELECT snapshot FROM runtimes').get()!.snapshot).toBeNull()
  // One new run and one changed status touch only their own parts.
  const pod = state.pods[0]!
  const run = { ...pod.runs.runs[0]!, id: randomUUID(), summary: 'Newest' }
  pod.runs.runs.unshift(run); pod.history[run.id] = { runs: [run], events: [] }
  pod.runs.events = []
  state.archive.tables.run_events!.push({ id: 40 })
  const second = publishV2(store, actor, lease, first.manifest, state, 2)
  expect(Object.keys(second.changes).sort()).toEqual([`pod/${podId}`, `pod/${podId}/events/${run.id}`, `pod/${podId}/run/${run.id}`, 'table/run_events/2'].sort())
  expect(JSON.stringify(second.staged).length).toBeLessThan(3000)
  expect(store.read(actor.owner, actor.id, podId).pod).toEqual(pod)
  expect(store.archive(actor, lease)).toEqual(parseCentralSnapshot(state))
})

it('refuses stale, incomplete, tampered or mismatching format-2 publications without committing', () => {
  const { store, actor, lease, state } = setup()
  const parts = encodeParts(splitSnapshot(withRuns(state, 2)))
  const manifest = Object.fromEntries(Array.from(parts, ([key, part]) => [key, part.hash]))
  const changes = Object.fromEntries(Object.entries(manifest))
  const hash = manifestDigest(manifest)
  expect(() => store.publishParts(actor, lease, randomUUID(), 1, changes, hash)).toThrow('workspace_part_missing')
  expect(() => store.stage(actor, lease, { ['0'.repeat(64)]: { forged: true } })).toThrow('part_hash_mismatch')
  store.stage(actor, lease, Object.fromEntries(Array.from(parts.values(), part => [part.hash, JSON.parse(part.text)])))
  expect(() => store.publishParts(actor, lease, randomUUID(), 0, changes, hash)).toThrow('workspace_revision_conflict')
  expect(() => store.publishParts(actor, lease, randomUUID(), 1, changes, 'f'.repeat(64))).toThrow('workspace_manifest_mismatch')
  const orphan = `pod/${state.pods[0]!.id}/run/${state.pods[0]!.runs.runs[0]!.id}`
  const withoutRun = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== orphan))
  expect(() => store.publishParts(actor, lease, randomUUID(), 1, { ...changes, [orphan]: null }, manifestDigest(withoutRun))).toThrow('Invalid history Pod binding')
  expect(store.inventory(actor.owner)[0]!.revision).toBe(1)
  expect(store.publishParts(actor, lease, randomUUID(), 1, changes, hash).revision).toBe(2)
})

it('accepts a heartbeat that raced the replacing publication but not an older hash', () => {
  const { store, actor, lease, state, publication } = setup()
  state.pods[0]!.details.checkpointRevision++
  const second = store.publish(actor, lease, randomUUID(), 1, state)
  store.heartbeat(actor, lease, publication.hash)
  store.heartbeat(actor, lease, second.hash)
  state.pods[0]!.details.checkpointRevision++
  store.publish(actor, lease, randomUUID(), 2, state)
  expect(() => store.heartbeat(actor, lease, publication.hash)).toThrow('workspace_reconciliation_required')
})

it('splits snapshots stored by an older server once, keeping the hash the desktop holds', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pods-workspace-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const { store, actor, state, publication } = setup(join(directory, 'workspace.sqlite'))
  store.db.exec('DELETE FROM parts; UPDATE runtimes SET parts_hash=\'\'')
  const reopened = new WorkspaceStore(join(directory, 'workspace.sqlite'), store.now); cleanup.push(() => reopened.close())
  expect(reopened.inventory(actor.owner)[0]).toMatchObject({ online: true, revision: 1 })
  expect(reopened.read(actor.owner, actor.id, state.pods[0]!.id).pod).toEqual(state.pods[0])
  expect(reopened.db.prepare('SELECT hash, snapshot IS NOT NULL AS kept FROM runtimes').get()).toMatchObject({ hash: publication.hash, kept: 1 })
})

it('shows when a runtime was last seen, keeps archived Pods archived offline and exposes a blocked queue', () => {
  const { store, actor, lease, state, advance } = setup()
  state.pods[0]!.scheduling = { ...state.pods[0]!.scheduling, blocked: 1, blockedSince: 5000, error: 'Pod execution permission is no longer active' }
  store.publish(actor, lease, randomUUID(), 1, state)
  expect(store.inventory(actor.owner)[0]).toMatchObject({ lastSeenAt: 100000, workspace: { pods: [{ online: true, queue: { blocked: 1, since: 5000, error: 'Pod execution permission is no longer active' } }] } })
  state.workspace.pods[0]!.lifecycle = 'archived'; state.pods[0]!.scripts.pod.lifecycle = 'archived'
  store.publish(actor, lease, randomUUID(), 2, state)
  advance(30001)
  expect(store.inventory(actor.owner)[0]).toMatchObject({ online: false, lastSeenAt: 100000, workspace: { pods: [{ online: false, lifecycle: 'archived' }] } })
})
