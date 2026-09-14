import { mkdtemp, realpath, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { MasterControl } from '../src/worker/master/control'
import { MasterService } from '../src/worker/master/service'
import type { AgentRuntime } from '../src/worker/agent/executor'
import type { AgentGatewayServices } from '../src/worker/agent/gateway'
import { recordedResponse } from './fixtures/responses'

let root = ''; let store: PodDatabase; let dispatcher: RunDispatcher; let master: MasterService
async function setup(provider?: AgentGatewayServices['provider'], packaged = false) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-master-'))); store = new PodDatabase(root)
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents'); const dist = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist') : resolve('dist')
  const runtime: AgentRuntime = { helper: join(dist, 'native/pods-helper'), executable: packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath, entry: join(dist, 'runtime/script-entry.mjs'), runtimeDirectories: packaged ? [bundle] : [], environment: packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}, binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs') }
  const registry = new ResourceRegistry(store, podId => dispatcher.cancelPod(podId, 'Permissions changed'))
  dispatcher = new RunDispatcher(store, registry, runtime); const scheduler = new Scheduler(store, dispatcher)
  const control = new MasterControl(store, registry, dispatcher, scheduler, runtime)
  master = new MasterService(store, runtime, control, provider)
  return { control, registry, runtime, scheduler }
}
afterEach(async () => { await master?.stop(); await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
const code = 'export async function run(c) { await c.progress.commit({expectedRevision:c.input.checkpointRevision,checkpoint:{checked:true},sources:[],claims:[]}); return {status:\'completed\',summary:\'Synthetic draft completed\',completedInputIds:[],gapIds:[]} }'
describe('master actions and actual app-server', () => {
  it('validates and activates a native draft, preserves idempotency and rejects permission or revision escalation', async () => {
    const { control, registry } = await setup(); const signal = new AbortController().signal
    const created = await control.execute('create', { action: 'create', name: 'Synthetic knowledge', assignment: 'Read assigned evidence' }, signal) as { id: string, revision: number }
    expect(await control.execute('create', { action: 'create', name: 'Synthetic knowledge', assignment: 'Read assigned evidence' }, signal)).toEqual(created)
    expect(store.listPods()).toHaveLength(1)
    await expect(control.execute('create', { action: 'create', name: 'Changed', assignment: 'Read assigned evidence' }, signal)).rejects.toThrow('reused')
    const scope = { podId: created.id, revision: 1 }
    const draft = await control.execute('draft', { action: 'draft', ...scope, draftId: null, draftRevision: 0, code, capabilities: [] }, signal) as { draftId: string, draftRevision: number }
    const draftScope = { ...scope, draftId: draft.draftId, draftRevision: draft.draftRevision }
    await expect(control.execute('early', { action: 'activate', ...draftScope }, signal)).rejects.toThrow('Validate')
    const checked = await control.execute('validate', { action: 'validate', ...draftScope }, signal) as { hash: string }
    await control.execute('activate', { action: 'activate', ...draftScope }, signal)
    expect(store.getPod(created.id).activeScript).toBe(checked.hash)
    await control.execute('run', { action: 'run', ...scope }, signal)
    await expect.poll(() => dispatcher.view(created.id).runs[0]?.state).toBe('completed')
    expect(store.checkpoint(created.id).body).toEqual({ checked: true })
    await expect(control.execute('expand', { action: 'grant', ...scope }, signal)).rejects.toThrow('not allowed')
    await control.execute('request', { action: 'requestAccess', ...scope, request: { provider: 'microsoft', account: 'synthetic@example.invalid', folders: ['Inbox'], attachments: false, description: 'Read this synthetic mailbox' } }, signal)
    expect(registry.list(created.id)).toHaveLength(0); expect(master.view().proposals[0]?.state).toBe('pending')
    await control.execute('revise', { action: 'revise', ...scope, name: 'Revised', assignment: 'A different assignment' }, signal)
    await expect(control.execute('stale', { action: 'activate', ...draftScope }, signal)).rejects.toThrow('assignment changed')
    await expect(control.execute('resume', { action: 'resume', podId: created.id, revision: 2 }, signal)).rejects.toThrow('Validate')
  })
  it('rejects a draft that escapes the native filesystem boundary and retains the active version', async () => {
    const { control } = await setup(); const pod = store.createPod({ name: 'Boundary', assignment: 'Read' }); await dispatcher.install(pod.id, 'deterministic')
    const active = store.getPod(pod.id).activeScript; const signal = new AbortController().signal
    const draft = await control.execute('draft', { action: 'draft', podId: pod.id, revision: 1, draftId: null, draftRevision: 0, code: `import {writeFileSync} from 'node:fs'; export async function run(){writeFileSync(${JSON.stringify(join(root, 'outside'))},'bad')}`, capabilities: [] }, signal) as { draftId: string, draftRevision: number }
    await expect(control.execute('check', { action: 'validate', podId: pod.id, revision: 1, ...draft }, signal)).rejects.toThrow()
    expect(store.getPod(pod.id).activeScript).toBe(active); expect(master.view().drafts[0]?.validation).toBeNull()
  })
  it.each([false, true])('streams a dynamic action through confined app-server and resumes the same thread (packaged=%s)', async (packaged) => {
    let calls = 0; const requests: unknown[] = []
    await setup(async (body) => { requests.push(body); return ++calls === 1 ? recordedResponse({ type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'pods_control', arguments: JSON.stringify({ action: 'create', name: 'Created by master', assignment: 'Synthetic recorded fixture' }) }) : recordedResponse() }, packaged)
    const command = { type: 'send' as const, id: randomUUID(), text: 'Create a synthetic pod.', podId: null }
    await master.execute(command)
    await expect.poll(() => master.view().state, { timeout: 20000 }).toBe('idle')
    expect(store.listPods()).toHaveLength(1); expect(master.view().messages.some(message => message.text === 'SYNTHETIC_RESPONSE_COMPLETE')).toBe(true)
    const thread = store.db.prepare('SELECT thread_id FROM master_session').get()?.thread_id
    await master.execute(command); expect(calls).toBe(2)
    await master.execute({ ...command, id: randomUUID(), text: 'Confirm the earlier result.' })
    await expect.poll(() => master.view().state, { timeout: 20000 }).toBe('idle')
    expect(store.db.prepare('SELECT thread_id FROM master_session').get()?.thread_id).toBe(thread)
    expect(store.listPods()).toHaveLength(1); expect(JSON.stringify(requests[2])).toContain('Create a synthetic pod')
  })
  it('denies a model-forced built-in command and reports provider disconnection visibly', async () => {
    let calls = 0; const requests: unknown[] = []
    await setup(async (body) => {
      requests.push(body)
      if (++calls === 1) return recordedResponse({ type: 'function_call', id: 'escape', call_id: 'escape', namespace: 'functions', name: 'exec_command', arguments: JSON.stringify({ cmd: `touch ${join(root, 'unassigned')}` }) })
      throw new Error('Synthetic provider disconnected')
    })
    await master.execute({ type: 'send', id: randomUUID(), text: 'Synthetic adversarial transport', podId: null })
    await expect.poll(() => master.view().state, { timeout: 20000 }).toBe('failed')
    expect(JSON.stringify(requests[1])).toMatch(/unknown|unsupported|not available|not found/i)
    expect(master.view().error).toBeTruthy(); expect(store.listPods()).toHaveLength(0)
    await expect(access(join(root, 'unassigned'))).rejects.toThrow()
    expect(store.db.prepare('SELECT count(*) AS count FROM master_actions').get()?.count).toBe(0)
  })
  it('cancels a stalled provider and records an interrupted turn without replay on restart', async () => {
    let called = false
    const { control, runtime } = await setup(async (_body, signal) => { called = true; return new Promise<Response>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) })
    await master.execute({ type: 'send', id: randomUUID(), text: 'Wait for synthetic service', podId: null })
    await expect.poll(() => called).toBe(true)
    await master.execute({ type: 'steer', id: randomUUID(), text: 'Only inspect; do not create anything.', podId: null })
    expect(master.view().messages.at(-1)?.state).toBe('sent')
    await master.execute({ type: 'cancel' }); expect(master.view().state).toBe('interrupted')
    master = new MasterService(store, runtime, control)
    expect(master.view().messages).toHaveLength(2); expect(master.view().state).toBe('interrupted'); expect(master.view().connected).toBe(false)
  })
})
it('keeps model conversation history and continuation threads separate for each pod', async () => {
  const requests: unknown[] = []
  await setup(async (body) => { requests.push(body); return recordedResponse() }, true)
  const one = store.createPod({ name: 'One', assignment: 'First task' }); const two = store.createPod({ name: 'Two', assignment: 'Second task' })
  for (const [podId, text] of [[one.id, 'ONLY_FIRST_POD_CONTEXT'], [two.id, 'ONLY_SECOND_POD_CONTEXT'], [one.id, 'Continue first']]) {
    await master.execute({ type: 'send', podId, text, id: randomUUID() })
    await expect.poll(() => master.view(podId).state, { timeout: 20000 }).toBe('idle')
  }
  expect(JSON.stringify(requests[1])).not.toContain('ONLY_FIRST_POD_CONTEXT')
  expect(JSON.stringify(requests[2])).toContain('ONLY_FIRST_POD_CONTEXT')
  expect(JSON.stringify(requests[2])).not.toContain('ONLY_SECOND_POD_CONTEXT')
  expect(master.view(one.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['ONLY_FIRST_POD_CONTEXT', 'Continue first'])
  expect(master.view(two.id).messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['ONLY_SECOND_POD_CONTEXT'])
  const threads = store.db.prepare('SELECT thread_id FROM master_contexts WHERE scope IN (?,?)').all(one.id, two.id).map(row => row.thread_id)
  expect(new Set(threads).size).toBe(2)
  const proposal = randomUUID(); store.db.prepare('INSERT INTO access_proposals VALUES(?,?,?,?)').run(proposal, two.id, '{}', 'pending')
  const response = await master.execute({ type: 'decline', id: proposal, podId: two.id })
  expect(response.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['ONLY_SECOND_POD_CONTEXT'])
})
