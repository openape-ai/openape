import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { RunServices } from '../src/worker/runs/dispatcher'
import { authorizeMailService } from '../src/worker/mail/authorization'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
async function setup(services?: RunServices) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-dispatch-')))
  store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, id => dispatcher?.cancelPod(id))
  dispatcher = new RunDispatcher(store, resources, { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }, services)
  return { store, dispatcher, resources, pod: store.createPod({ name: 'Synthetic pod', assignment: 'Run local synthetic scripts only.' }) }
}
describe('manual dispatch', () => {
  it('pins the version, shares one lease, persists acknowledged progress and replays ordered events', async () => {
    const { store, dispatcher, pod } = await setup()
    await dispatcher.install(pod.id, 'deterministic')
    const id = dispatcher.start(pod.id)
    expect(dispatcher.start(pod.id)).toBe(id)
    await expect.poll(() => dispatcher.runs.get(id).state).toBe('completed')
    expect(store.checkpoint(pod.id)).toMatchObject({ revision: 1, body: { exampleRuns: 1 } })
    const events = dispatcher.view(pod.id, id).events
    expect(events.map(event => event.sequence)).toEqual(events.map((_event, i) => i + 1))
    expect(events.map(event => event.type)).toContain('checkpoint')
    expect(dispatcher.view(pod.id, id, events[1]!.sequence).events).toEqual(events.slice(2))
    const next = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(next).state).toBe('completed')
    expect(store.checkpoint(pod.id)).toMatchObject({ revision: 2, body: { exampleRuns: 2 } })
  })
  it('makes provider absence visible without committing progress or reporting success', async () => {
    const { store, dispatcher, pod } = await setup()
    await dispatcher.install(pod.id, 'agent')
    const id = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(id).state).toBe('failed')
    expect(dispatcher.runs.get(id).error).toContain('Codex is not connected')
    expect(store.checkpoint(pod.id).revision).toBe(0)
  })
  it('rejects stale validation after resource assignment changes', async () => {
    const { dispatcher, resources, pod } = await setup()
    await dispatcher.install(pod.id, 'deterministic')
    resources.assignReference(pod.id, 'Synthetic', join(root, 'not-yet-created.txt'))
    expect(() => dispatcher.start(pod.id)).toThrow('validation')
    expect(dispatcher.view(pod.id).runs).toHaveLength(0)
  })
})

it('routes a script tool call with a frozen lease and rejects scope substitution before broker access', async () => {
  const calls: unknown[] = []
  const fixture = await setup({ tool: async (body, _signal, scope) => {
    const checked = authorizeMailService(fixture.store, fixture.resources, fixture.dispatcher.runs, { scope: { podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities } })
    expect(checked.resources).toHaveLength(1)
    expect(() => authorizeMailService(fixture.store, fixture.resources, fixture.dispatcher.runs, { scope: { podId: randomUUID(), runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities } })).toThrow()
    expect(() => authorizeMailService(fixture.store, fixture.resources, fixture.dispatcher.runs, { scope: { podId: scope.podId, runId: scope.runId, epoch: scope.epoch + 1, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities } })).toThrow()
    calls.push(body); return { items: ['synthetic'] }
  } })
  const { store, dispatcher, pod, resources } = fixture
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pod.id, 'tool', 'ready', 'Synthetic mail permission', '{"capability":"mail.read"}')
  await dispatcher.install(pod.id, 'deterministic')
  const previous = store.getPod(pod.id).activeScript
  const old = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, previous)!.manifest as string)
  const code = `export async function run(ctx) { const page = await ctx.tools.invoke({toolId:'o365-mail',argv:['synthetic']}); await ctx.progress.commit({expectedRevision:ctx.input.checkpointRevision, checkpoint:{count:page.items.length},sources:[],claims:[]}); return {status:'completed',summary:'Read synthetic page',completedInputIds:[],gapIds:[]}; }`
  const lock = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const manifest = store.storeScript(pod.id, { ...old, capabilities: ['mail.read'], dependencyLockHash: lock.dependencyLockHash, contentHash: digest(code) }, code)
  store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(pod.id, manifest.contentHash, pod.revision, resources.epoch(pod.id), '{}')
  store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(manifest.contentHash, pod.id)
  const id = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.runs.get(id).state).toBe('completed')
  expect(calls).toHaveLength(1); expect(store.checkpoint(pod.id).body).toEqual({ count: 1 })
})

it.each([false, true])('combines credential reads, files, variables and Codex; secret forwarding requires explicit source (forward=%s)', async (forward) => {
  const { ScriptCredentials } = await import('../src/worker/resources/script-credentials')
  const { authorizeCredentialService } = await import('../src/worker/mail/authorization')
  const { recordedResponse } = await import('./fixtures/responses')
  const requests: unknown[] = []; const secret = 'SYNTHETIC_DIRECT_CREDENTIAL'
  const f = await setup({
    credential: async (alias, _signal, scope) => { authorizeCredentialService(f.store, f.resources, f.dispatcher.runs, { scope: { podId: scope.podId, runId: scope.runId, epoch: scope.epoch, assignmentRevision: scope.assignmentRevision, capabilities: scope.capabilities } }, alias); return secret },
    provider: async (body) => { requests.push(body); return requests.length === 1 ? recordedResponse({ type: 'function_call', id: 'credential-attempt', call_id: 'credential-attempt', namespace: 'mcp__pod', name: 'ape_shell', arguments: JSON.stringify({ toolId: 'credentials', argv: ['get', 'crm'] }) }) : recordedResponse() },
  })
  f.resources.assignCredential(f.pod.id, 'crm', randomUUID(), 0)
  await f.dispatcher.install(f.pod.id, 'deterministic')
  const original = JSON.parse(f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(f.pod.id)!.manifest as string)
  const code = `import {readFile,writeFile} from 'node:fs/promises'; export async function run(c) {
    const value = await c.credentials.get('crm'); if(!value) throw new Error('Missing fixture credential');
    await writeFile(c.workspace+'/input.txt','Summarize these synthetic notes');
    const prompt=await readFile(c.workspace+'/input.txt','utf8'); const answer=await c.agent.run({prompt: ${forward ? 'prompt + value' : 'prompt'}});
    await writeFile(c.workspace+'/output.txt',answer.response);
    await c.progress.commit({expectedRevision:c.input.checkpointRevision,checkpoint:{count:(c.input.checkpoint.count??0)+1},sources:[],claims:[]});
    return {status:'completed',summary:'Combined script complete',completedInputIds:[],gapIds:[]}; }`
  const hash = digest(code)
  f.store.storeScript(f.pod.id, { ...original, capabilities: ['credential.crm'], contentHash: hash }, code)
  f.store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(f.pod.id, hash, 1, 1, '{}')
  new ScriptCredentials(f.store, f.resources).approve(f.pod.id, hash, 1, 1)
  f.store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, f.pod.id)
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id), { timeout: 20000 }).toMatchObject({ state: 'completed', error: null })
  expect(requests).toHaveLength(2); expect(JSON.stringify(requests).includes(secret)).toBe(forward)
  expect(JSON.stringify(requests[1])).toContain('No tool capability is assigned')
  if (!forward) expect(JSON.stringify(f.dispatcher.view(f.pod.id, id))).not.toContain(secret)
  expect(await readFile(join(f.store.root, 'runs', id, 'input.json'), 'utf8')).not.toContain(secret)
  expect(await readFile(join(f.store.root, 'pods', f.pod.id, 'workspace', 'output.txt'), 'utf8')).toBe('SYNTHETIC_RESPONSE_COMPLETE')
  expect(f.store.checkpoint(f.pod.id).body).toEqual({ count: 1 })
})

it('cancels a credential read in progress after rotation and never returns its stale value to the script', async () => {
  const { ScriptCredentials } = await import('../src/worker/resources/script-credentials')
  let release: () => void = () => {}; let requested = false
  const pending = new Promise<void>((resolveRequest) => { release = resolveRequest })
  const f = await setup({ credential: async () => { requested = true; await pending; return 'SYNTHETIC_STALE_SECRET' } })
  f.resources.assignCredential(f.pod.id, 'crm', randomUUID(), 0); await f.dispatcher.install(f.pod.id, 'deterministic')
  const previous = JSON.parse(f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(f.pod.id)!.manifest as string)
  const code = `import {writeFile} from 'node:fs/promises'; export async function run(c) { const secret=await c.credentials.get('crm'); await writeFile(c.workspace+'/stale.txt',secret); return {status:'completed',summary:'Incorrect stale read',completedInputIds:[],gapIds:[]}; }`
  const hash = digest(code); f.store.storeScript(f.pod.id, { ...previous, contentHash: hash, capabilities: ['credential.crm'] }, code)
  f.store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(f.pod.id, hash, 1, 1, '{}'); new ScriptCredentials(f.store, f.resources).approve(f.pod.id, hash, 1, 1)
  f.store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, f.pod.id)
  const id = f.dispatcher.start(f.pod.id)
  try {
    await expect.poll(() => requested).toBe(true)
    f.resources.assignCredential(f.pod.id, 'crm', randomUUID(), 1)
  }
  finally { release() }
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('cancelled')
  await expect(readFile(join(f.store.root, 'pods', f.pod.id, 'workspace', 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.stringify(f.dispatcher.view(f.pod.id, id))).not.toContain('SYNTHETIC_STALE_SECRET')
})
