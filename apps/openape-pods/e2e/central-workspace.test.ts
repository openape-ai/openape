import { randomUUID } from 'node:crypto'
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { MasterControl } from '../src/worker/master/control'
import { ScriptWorkspace } from '../src/worker/workspace/scripts'
import { CentralProjection } from '../src/worker/central/projection'
import { CentralController } from '../src/main/central/controller'
import { managedArtifacts } from '../src/main/central/artifacts'
import { WorkspaceStore } from '../../openape-pods-relay/server/utils/workspace-store'
import { parseScriptCommand } from '../src/contracts/scripts'
import type { ScriptView } from '../src/contracts/scripts'
import type { CentralCommand } from '../src/contracts/central'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task() })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-central-execution-')))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const store = new PodDatabase(root); cleanup.push(() => store.close())
  let runs: RunDispatcher
  const resources = new ResourceRegistry(store, id => runs.cancelPod(id))
  const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }
  runs = new RunDispatcher(store, resources, runtime); cleanup.push(() => runs.stop())
  const scheduler = new Scheduler(store, runs)
  const master = new MasterControl(store, resources, runs, scheduler, runtime)
  const scripts = new ScriptWorkspace(store, resources, master, runtime)
  const projection = new CentralProjection(store, resources, scripts, runs, scheduler)
  const owner = { issuer: 'https://fixture.example', subject: 'owner' }
  const actor = { id: randomUUID(), generation: randomUUID(), owner }
  const pod = store.createPod({ name: 'Synthetic central monitor' })
  const identity = { podId: pod.id, subject: 'pod@fixture.example', issuer: 'https://pods.example', keyId: 'synthetic-public-reference' }
  store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(pod.id, JSON.stringify(owner), actor.id, actor.generation, 'ready', JSON.stringify(identity))
  const server = new WorkspaceStore(join(root, 'central-service.sqlite')); cleanup.push(() => server.close())
  const request = async (body: Record<string, unknown>): Promise<unknown> => {
    const lease = String(body.lease)
    if (body.type === 'begin') return server.begin(actor)
    if (body.type === 'publish') return server.publish(actor, lease, String(body.id), Number(body.revision), body.snapshot, body.completion as Parameters<WorkspaceStore['publish']>[5])
    if (body.type === 'heartbeat') return server.heartbeat(actor, lease, String(body.hash))
    if (body.type === 'claim') return server.claim(actor, lease)
    if (body.type === 'disconnect') return server.disconnect(actor, lease)
    if (body.type === 'operation') return server.operation(owner, String(body.id))
    if (body.type === 'submit') return server.submit(owner, actor.id, Number(body.revision), body.command as CentralCommand, String(body.id), true)
    if (body.type === 'artifact') return server.putArtifact(actor, lease, String(body.podId), String(body.hash), Buffer.from(String(body.content), 'base64'))
    throw new Error(`Unexpected request: ${String(body.type)}`)
  }
  function controller() {
    const instance = new CentralController(root, request, { snapshot: async () => projection.snapshot(owner), execute: async (command) => {
      if (command.channel === 'scripts') return scripts.execute(parseScriptCommand(command.body), AbortSignal.timeout(30000))
      if (command.channel !== 'runs' || command.body.type !== 'start') throw new Error('Unexpected fixture command')
      return { runId: runs.start(pod.id) }
    }, gate: async () => {} }, runtime.helper)
    cleanup.push(() => instance.stop()); return instance
  }
  return { root, store, resources, runtime, runs, scheduler, projection, owner, actor, pod, server, controller }
}
it('adopts a real script and schedule, runs from browser and desktop, and resumes without duplicate effects', async () => {
  const f = await fixture()
  await f.runs.install(f.pod.id, 'deterministic')
  f.scheduler.save(f.pod.id, 0, { kind: 'interval', seconds: 900 }, true)
  const initial = f.projection.snapshot(f.owner)
  const central = f.controller(); central.start()
  await expect.poll(() => central.available, { timeout: 10000, message: 'Initial central adoption' }).toBe(true)
  const command = { channel: 'runs' as const, body: { type: 'start', podId: f.pod.id } }
  const id = randomUUID(); const revision = f.server.inventory(f.owner)[0]!.revision
  f.server.submit(f.owner, f.actor.id, revision, command, id)
  f.server.submit(f.owner, f.actor.id, revision, command, id)
  await expect.poll(() => f.server.operation(f.owner, id).state).toBe('applied')
  await expect.poll(() => f.server.read(f.owner, f.actor.id, f.pod.id).pod.runs.runs[0]?.state).toBe('completed')
  expect(f.store.checkpoint(f.pod.id).body).toEqual({ exampleRuns: 1 })
  await central.local(async () => ({ runId: f.runs.start(f.pod.id) }))
  await expect.poll(() => f.store.checkpoint(f.pod.id).revision).toBe(2)
  await expect.poll(() => f.server.read(f.owner, f.actor.id, f.pod.id).pod.details.checkpointRevision).toBe(2)
  await central.stop()
  await expect(central.local(async () => f.runs.start(f.pod.id))).rejects.toThrow()
  const resumed = f.controller(); resumed.start()
  await expect.poll(() => resumed.available, { timeout: 10000 }).toBe(true)
  const current = f.server.read(f.owner, f.actor.id, f.pod.id).pod
  expect(current.runs.runs).toHaveLength(2)
  expect(current.scheduling.spec).toEqual(initial.pods[0]!.scheduling.spec)
  expect(current.scheduling.revision).toBe(initial.pods[0]!.scheduling.revision)
  const snapshot = JSON.parse(String(f.server.db.prepare('SELECT snapshot FROM runtimes').get()!.snapshot))
  expect(snapshot.archive.tables.remote_pods[0].identity).toContain('synthetic-public-reference')
  expect(Object.keys(snapshot.archive.tables)).not.toContain('remote_registration')
  const script = initial.workspace.pods[0]!.activeScript!
  expect(Buffer.from(f.server.artifact(f.owner, f.actor.id, f.pod.id, `blobs/${script}`))).toEqual(await readFile(join(f.root, 'blobs', script)))
})
it('captures only managed files and refuses symbolic links and hard links', async () => {
  const f = await fixture()
  const workspace = join(f.root, 'pods', f.pod.id, 'workspace')
  await mkdir(workspace, { recursive: true }); await writeFile(join(workspace, '.settings'), 'managed content')
  await writeFile(join(f.root, 'private-credentials'), 'outside-managed-root')
  const snapshot = f.projection.snapshot(f.owner)
  const files = await managedArtifacts(f.root, snapshot, f.runtime.helper)
  expect(files.map(item => item.path)).toEqual(['workspace/.settings'])
  expect(files[0]?.content).toBe(Buffer.from('managed content').toString('base64'))
  await symlink(join(f.root, 'private-credentials'), join(workspace, 'linked'))
  await expect(managedArtifacts(f.root, snapshot, f.runtime.helper)).rejects.toThrow()
  await rm(join(workspace, 'linked')); await link(join(f.root, 'private-credentials'), join(workspace, 'linked'))
  await expect(managedArtifacts(f.root, snapshot, f.runtime.helper)).rejects.toThrow('without links')
})

it('uses the centrally edited and validated script in the next actual run', async () => {
  const f = await fixture()
  await f.runs.install(f.pod.id, 'deterministic')
  const central = f.controller(); central.start()
  await expect.poll(() => central.available, { timeout: 10000 }).toBe(true)
  async function send(command: CentralCommand) {
    const id = randomUUID(); const revision = f.server.inventory(f.owner)[0]!.revision
    f.server.submit(f.owner, f.actor.id, revision, command, id)
    await expect.poll(() => f.server.operation(f.owner, id).state).toBe('applied')
    return f.server.operation(f.owner, id).result as ScriptView
  }
  const code = 'export async function run() { return {status:\'completed\',summary:\'Central version executed\',completedInputIds:[],gapIds:[]}; }'
  const saved = await send({ channel: 'scripts', body: { type: 'save', podId: f.pod.id, revision: f.store.getPod(f.pod.id).revision, draftId: null, draftRevision: 0, code, capabilities: [] } })
  const draft = saved.source!
  const validated = await send({ channel: 'scripts', body: { type: 'validate', podId: f.pod.id, revision: saved.pod.revision, draftId: draft.id, draftRevision: draft.revision } })
  expect(validated.source?.validated).toBe(true)
  await send({ channel: 'scripts', body: { type: 'activate', podId: f.pod.id, revision: validated.pod.revision, hash: validated.source!.hash, expectedActive: validated.pod.activeScript } })
  await send({ channel: 'runs', body: { type: 'start', podId: f.pod.id } })
  await expect.poll(() => f.server.read(f.owner, f.actor.id, f.pod.id).pod.runs.runs[0]?.summary).toBe('Central version executed')
  expect(f.runs.view(f.pod.id).runs).toHaveLength(1)
})
