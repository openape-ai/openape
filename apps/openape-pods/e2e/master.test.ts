import { mkdtemp, realpath, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { ScriptWorkspace } from '../src/worker/workspace/scripts'
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
    const created = await control.execute('create', { action: 'create', name: 'Synthetic knowledge' }, signal) as { id: string, revision: number }
    expect(await control.execute('create', { action: 'create', name: 'Synthetic knowledge' }, signal)).toEqual(created)
    expect(store.listPods()).toHaveLength(1)
    await expect(control.execute('create', { action: 'create', name: 'Changed' }, signal)).rejects.toThrow('reused')
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
    await control.execute('revise', { action: 'revise', ...scope, name: 'Revised' }, signal)
    await expect(control.execute('stale', { action: 'activate', ...draftScope }, signal)).rejects.toThrow('settings changed')
    await expect(control.execute('resume', { action: 'resume', podId: created.id, revision: 2 }, signal)).resolves.toMatchObject({ lifecycle: 'active', activeScript: checked.hash })
  })
  it('rejects a draft that escapes the native filesystem boundary and retains the active version', async () => {
    const { control } = await setup(); const pod = store.createPod({ name: 'Boundary' }); await dispatcher.install(pod.id, 'deterministic')
    const active = store.getPod(pod.id).activeScript; const signal = new AbortController().signal
    const draft = await control.execute('draft', { action: 'draft', podId: pod.id, revision: 1, draftId: null, draftRevision: 0, code: `import {writeFileSync} from 'node:fs'; export async function run(){writeFileSync(${JSON.stringify(join(root, 'outside'))},'bad')}`, capabilities: [] }, signal) as { draftId: string, draftRevision: number }
    await expect(control.execute('check', { action: 'validate', podId: pod.id, revision: 1, draftId: draft.draftId, draftRevision: draft.draftRevision }, signal)).rejects.toThrow()
    expect(store.getPod(pod.id).activeScript).toBe(active); expect(master.view().drafts[0]?.validation).toBeNull()
  })
  it.each([false, true])('streams a dynamic action through confined app-server and resumes the same thread (packaged=%s)', async (packaged) => {
    let calls = 0; const requests: unknown[] = []
    await setup(async (body) => { requests.push(body); return ++calls === 1 ? recordedResponse({ type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'pods_control', arguments: JSON.stringify({ action: 'create', name: 'Created by master' }) }) : recordedResponse() }, packaged)
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
  await setup(async (body) => { if (!JSON.stringify(body).includes('previousDescription')) requests.push(body); return recordedResponse() }, true)
  const one = store.createPod({ name: 'One' }); const two = store.createPod({ name: 'Two' })
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
  const proposal = randomUUID(); store.db.prepare('INSERT INTO access_proposals VALUES(?,?,?,?)').run(proposal, two.id, JSON.stringify({ provider: 'reference', description: 'Read an assigned file' }), 'pending')
  const response = await master.execute({ type: 'decline', id: proposal, podId: two.id })
  expect(response.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['ONLY_SECOND_POD_CONTEXT'])
})

it('denies a model-forced read of another pod from a selected pod chat', async () => {
  let target = ''; let calls = 0; const requests: unknown[] = []
  await setup(async (body) => {
    requests.push(body)
    return ++calls === 1 ? recordedResponse({ type: 'function_call', id: 'cross-pod', call_id: 'cross-pod', name: 'pods_control', arguments: JSON.stringify({ action: 'inspect', podId: target, revision: 1 }) }) : recordedResponse()
  })
  const selected = store.createPod({ name: 'Selected' })
  target = store.createPod({ name: 'Private other pod' }).id
  await master.execute({ type: 'send', podId: selected.id, text: 'Inspect my configuration', id: randomUUID() })
  await expect.poll(() => master.view(selected.id).state, { timeout: 20000 }).toBe('idle')
  expect(JSON.stringify(requests[1])).not.toContain('CROSS_POD_PRIVATE_ASSIGNMENT')
  expect(master.view(selected.id).messages.some(message => message.text.includes('outside the selected pod'))).toBe(true)
})

it('persists ordinary setup, keeps automation disabled and enforces revisions and scope before replay', async () => {
  const { control, registry, scheduler } = await setup(); const signal = new AbortController().signal
  const pod = store.createPod({ name: 'Setup' }); const other = store.createPod({ name: 'Other' })
  const scope = { podId: pod.id, revision: pod.revision }; let key = 0
  const action = (value: Record<string, unknown>) => control.execute(`setup-${++key}`, { ...scope, ...value }, signal, pod.id)
  const list = { action: 'list' }
  expect(await control.execute('scoped-list', list, signal, pod.id)).toEqual({ pods: [pod] })
  await expect(control.execute('scoped-list', list, signal, other.id)).rejects.toThrow('reused')
  const inspectOther = { action: 'inspect', podId: other.id, revision: 1 }
  await control.execute('other-inspection', inspectOther, signal)
  await expect(control.execute('other-inspection', inspectOther, signal, pod.id)).rejects.toThrow('outside the selected pod')
  await expect(action({ action: 'setVariable', podId: other.id, name: 'target', value: 'changed', variableRevision: 0 })).rejects.toThrow('outside the selected pod')
  await expect(control.execute('scoped-create', { action: 'create', name: 'Wrong' }, signal, pod.id)).rejects.toThrow('outside the selected pod')
  await action({ action: 'setVariable', name: 'greeting', value: 'Hello from chat', variableRevision: 0 })
  await expect(action({ action: 'setVariable', name: 'greeting', value: 'Stale', variableRevision: 0 })).rejects.toThrow('Variable changed')
  scheduler.save(pod.id, 0, { kind: 'interval', seconds: 60 }, true); scheduler.lifecycle(pod.id, 1, 'active')
  await expect(action({ action: 'prepareSchedule', scheduleRevision: 0, spec: { kind: 'interval', seconds: 900 } })).rejects.toThrow('Stale schedule')
  await action({ action: 'prepareSchedule', scheduleRevision: 1, spec: { kind: 'interval', seconds: 900 } })
  await expect(action({ action: 'prepareSchedule', scheduleRevision: 2, spec: { kind: 'interval', seconds: 900 }, enabled: true })).rejects.toThrow('fields')
  await action({ action: 'setGroup', name: 'Examples', organizationRevision: 1 })
  await expect(action({ action: 'setGroup', name: 'Unwanted', organizationRevision: 1 })).rejects.toThrow('Groups changed')
  const credentialId = randomUUID(); registry.assignCredential(pod.id, 'notification_token', credentialId, 0)
  const reference = registry.assignReference(pod.id, 'Read-only reference', '/private/owner-only.txt')
  const adapterPath = join(root, 'fixture.toml')
  const adapter = 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read fixture"\naction="read"\nrisk="low"\nresource_chain=["fixture:*"]\n'
  await writeFile(adapterPath, adapter)
  const adapterHash = createHash('sha256').update(adapter).digest('hex')
  store.db.prepare('INSERT INTO resources VALUES(?,?,1,?,?,?,?)').run(randomUUID(), pod.id, 'tool', 'ready', 'Synthetic application', JSON.stringify({ type: 'program', cliId: 'fixture', adapterPath, adapterHash, capability: 'tool.fixture.read', stateId: 'PRIVATE_STATE_ID', environment: { TOKEN: 'PRIVATE_ENV_VALUE' }, executable: '/private/host/tool', grants: [{ permission: 'fixture.read', display: 'PRIVATE_COMMAND_DETAIL', authority: { grantId: 'PRIVATE_GRANT_ID' } }] }))
  const inspected = await action({ action: 'inspect' }) as { variables: unknown[], schedule: { enabled: boolean, spec: unknown }, organization: { revision: number, groups: unknown[] }, resources: { id: string, configuration: unknown }[] }
  expect(inspected.variables).toEqual([{ name: 'greeting', value: 'Hello from chat', revision: 1 }])
  expect(inspected.schedule).toMatchObject({ enabled: false, spec: { kind: 'interval', seconds: 900 } })
  expect(inspected.organization.groups).toEqual([expect.objectContaining({ name: 'Examples', selected: true })])
  expect(inspected.resources.find(resource => resource.id === reference.id)?.configuration).toEqual({})
  expect(JSON.stringify(inspected)).not.toContain(credentialId); expect(JSON.stringify(inspected)).not.toContain('/private/owner-only.txt'); expect(JSON.stringify(inspected)).not.toContain('PRIVATE_'); expect(JSON.stringify(inspected)).not.toContain('/private/host/tool')
  expect(inspected.resources.find(resource => (resource.configuration as { cliId?: string }).cliId === 'fixture')?.configuration).toEqual({ type: 'program', cliId: 'fixture', capability: 'tool.fixture.read', permissions: ['fixture.read'], commands: expect.arrayContaining([expect.objectContaining({ command: ['read'], action: 'read' })]) })
  await action({ action: 'setGroup', name: 'examples', organizationRevision: inspected.organization.revision })
  expect(store.db.prepare('SELECT count(*) AS n FROM pod_groups').get()?.n).toBe(1)
  const epoch = registry.epoch(pod.id)
  await action({ action: 'requestAccess', request: { provider: 'credential', alias: 'bot_token', description: 'Provide the notification token in Settings' } })
  await expect(action({ action: 'requestAccess', request: { provider: 'credential', alias: 'bot_token', value: 'DO_NOT_ACCEPT', description: 'Secret' } })).rejects.toThrow('proposal')
  expect(registry.epoch(pod.id)).toBe(epoch)
  expect(master.view(pod.id).proposals[0]?.body).toEqual({ provider: 'credential', alias: 'bot_token', description: 'Provide the notification token in Settings' })
  scheduler.tick(); expect(dispatcher.view(pod.id).runs).toEqual([])
  const reopened = new PodDatabase(root)
  try { expect(reopened.getPod(pod.id).lifecycle).toBe('paused'); expect(reopened.getPod(other.id)).toEqual(other); expect(reopened.db.prepare('SELECT value FROM pod_variables WHERE pod_id=?').get(pod.id)?.value).toBe('Hello from chat') }
  finally { reopened.close() }
})

it('executes the model-facing runtime example and preserves files and progress across runs', async () => {
  const { control, registry } = await setup(); const signal = new AbortController().signal
  const reference = await control.execute('reference', { action: 'runtime' }, signal) as { example: string }
  const pod = store.createPod({ name: 'Runtime reference' }); const scope = { podId: pod.id, revision: 1 }
  await control.execute('variable', { action: 'setVariable', ...scope, name: 'greeting', value: 'Documented runtime works', variableRevision: 0 }, signal)
  const draft = await control.execute('draft', { action: 'draft', ...scope, draftId: null, draftRevision: 0, code: reference.example, capabilities: [] }, signal) as { draftId: string, draftRevision: number }
  const draftScope = { ...scope, draftId: draft.draftId, draftRevision: draft.draftRevision }
  const inspected = await control.execute('inspect-draft', { action: 'inspect', ...scope }, signal) as { script?: { code: string, kind: string } }
  expect(inspected.script).toMatchObject({ kind: 'draft', code: reference.example })
  await control.execute('validate', { action: 'validate', ...draftScope }, signal)
  await control.execute('activate', { action: 'activate', ...draftScope }, signal)
  for (let count = 1; count <= 2; count++) {
    await control.execute(`run-${count}`, { action: 'run', ...scope }, signal)
    await expect.poll(() => store.checkpoint(pod.id).body.count).toBe(count)
    await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
    expect(dispatcher.view(pod.id).runs[0]?.summary).toBe(`Documented runtime works (${count})`)
  }
  const activeHash = store.getPod(pod.id).activeScript
  const active = await control.execute('inspect-active', { action: 'inspect', ...scope }, signal) as { script: { kind: string, code: string } }
  expect(active.script.kind).toBe('version'); expect(active.script.code).toContain(reference.example)
  const editedCode = reference.example.replace('Hello', 'Saved owner edit')
  await new ScriptWorkspace(store, registry, control).execute({ type: 'save', ...scope, draftId: draft.draftId, draftRevision: draft.draftRevision, code: editedCode, capabilities: [] }, signal)
  const edited = await control.execute('inspect-owner-edit', { action: 'inspect', ...scope }, signal, pod.id) as { script: unknown }
  expect(edited.script).toMatchObject({ kind: 'draft', id: draft.draftId, revision: 2, code: editedCode })
  expect(store.getPod(pod.id).activeScript).toBe(activeHash)
})

it('adopts a creation turn atomically and scopes later tool calls and replay to its new pod', async () => {
  const { control } = await setup(); const creationId = randomUUID(); const conversations = new (await import('../src/worker/master/conversations')).MasterConversations(store)
  const scope = conversations.begin(creationId)
  store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run('initial', 'user', 'Create a pod', 'sent', 1); conversations.assign('initial', scope)
  const signal = new AbortController().signal; const action = { action: 'create', name: 'Owned' }
  const pod = await control.execute('creation', action, signal, null, creationId) as { id: string }
  expect(await control.execute('creation', action, signal, null, creationId)).toEqual(pod)
  await expect(control.execute('second', action, signal, null, creationId)).rejects.toThrow('already')
  const other = store.createPod({ name: 'Other' })
  await expect(control.execute('cross', { action: 'inspect', podId: other.id, revision: 1 }, signal, null, creationId)).rejects.toThrow('outside')
  expect(master.view(pod.id).initialRequest?.text).toBe('Create a pod')
})

it('generates a bounded structured description through actual app-server without control tools', async () => {
  const { runtime } = await setup(); const requests: Record<string, unknown>[] = []
  const { summarizeConversation } = await import('../src/worker/master/summarize')
  const result = await summarizeConversation(store, runtime, async (body) => {
    requests.push(body as Record<string, unknown>)
    return recordedResponse({ type: 'message', id: 'summary', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ description: 'Checks every 30 minutes.' }), annotations: [] }] })
  }, JSON.stringify({ previousDescription: '', conversation: [{ role: 'user', text: 'Check every 30 minutes' }] }), new AbortController().signal)
  expect(result).toBe('Checks every 30 minutes.')
  expect(JSON.stringify(requests[0].tools ?? [])).not.toContain('pods_control')
  expect(store.listPods()).toHaveLength(0)
})

it('rejects validation results if the owner archives the pod while validation runs', async () => {
  const { control } = await setup(); const signal = new AbortController().signal
  const pod = store.createPod({ name: 'Archival race' })
  const draft = await control.execute('race-draft', { action: 'draft', podId: pod.id, revision: 1, draftId: null, draftRevision: 0, code, capabilities: [] }, signal) as { draftId: string, draftRevision: number }
  const validation = control.execute('race-validate', { action: 'validate', podId: pod.id, revision: 1, draftId: draft.draftId, draftRevision: draft.draftRevision }, signal)
  const outcome = expect(validation).rejects.toThrow('changed during validation')
  store.updatePod(pod.id, 1, { name: pod.name, lifecycle: 'archived' })
  await outcome
  expect(store.db.prepare('SELECT COUNT(*) AS count FROM validations').get()!.count).toBe(0)
})
