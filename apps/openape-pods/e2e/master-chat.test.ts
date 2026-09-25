import { mkdtemp, realpath, rm } from 'node:fs/promises'
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
import { ChatRegistry } from '../src/worker/master/chat-registry'
import type { AgentRuntime } from '../src/worker/agent/executor'
import type { AgentGatewayServices } from '../src/worker/agent/gateway'
import { recordedResponse } from './fixtures/responses'
import { PromptModel, setupAnswer, setupPrompt } from './fixtures/prompt-model'

// Chat scenarios formerly driven through the packaged UI (`prompt-setup`,
// `master-ui`, `chats`). What needs a real process is the confined Codex
// app-server, native draft validation and the sandboxed run; all of it runs
// here in Node without launching Electron. The UI of the same flows is covered
// by test/master/*-ui tests and test/layout/master-chat.test.ts.
let root = ''; let store: PodDatabase; let dispatcher: RunDispatcher; let master: MasterService
async function setup(provider: AgentGatewayServices['provider']) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-master-chat-'))); store = new PodDatabase(root)
  const dist = resolve('dist')
  const runtime: AgentRuntime = { helper: join(dist, 'native/pods-helper'), executable: process.execPath, entry: join(dist, 'runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: join(dist, 'vendor/codex'), catalog: join(dist, 'vendor/models.json'), manifest: join(dist, 'vendor/manifest.json'), sdkHost: join(dist, 'runtime/sdk-host.mjs') }
  const registry = new ResourceRegistry(store, podId => dispatcher.cancelPod(podId, 'Permissions changed'))
  dispatcher = new RunDispatcher(store, registry, runtime)
  const control = new MasterControl(store, registry, dispatcher, new Scheduler(store, dispatcher), runtime)
  master = new MasterService(store, runtime, control, provider)
}
afterEach(async () => { await master?.stop(); await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
const list = (scope: { podId?: string, conversationId?: string } = {}) => master.execute({ type: 'list', podId: scope.podId ?? null, ...(scope.conversationId ? { conversationId: scope.conversationId } : {}) })
const idle = (scope: { podId?: string, conversationId?: string } = {}) => expect.poll(async () => (await list(scope)).state, { timeout: 30000 }).toBe('idle')
const answer = (text: string) => recordedResponse({ type: 'message', id: randomUUID(), role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] })

describe('chat through the confined app-server', () => {
  it('repairs a draft from native validation feedback, stages every change and runs the reviewed script', async () => {
    const model = new PromptModel()
    await setup(async body => model.reply(body))
    const creationId = randomUUID()
    await master.execute({ type: 'begin', id: creationId })
    await master.execute({ type: 'send', id: randomUUID(), text: setupPrompt, podId: null, creationId })
    await expect.poll(async () => { const view = await master.execute({ type: 'list', podId: null, creationId }); return { state: view.state, error: view.error } }, { timeout: 40000 }).toEqual({ state: 'idle', error: null })
    const pod = store.listPods().find(item => item.name === 'Greeting')!
    const view = await list({ podId: pod.id })
    expect(view.messages.some(message => message.text === setupAnswer)).toBe(true)
    expect(view.messages.filter(message => message.role === 'user')).toHaveLength(1)
    // PromptModel throws unless the failed validation reached the model; the
    // second draft is the repair.
    expect(String(model.results.get(7)?.error)).toContain('Invalid checkpoint fields')
    expect(view.messages.filter(message => message.role === 'tool' && message.state === 'failed')).toHaveLength(1)
    expect(view.drafts[0]).toMatchObject({ podId: pod.id, revision: 2, validation: expect.stringContaining('native-synthetic-contract') })
    // Chat changes stay staged until the owner applies them; the model's run request starts nothing.
    expect(pod.activeScript).toBeNull()
    expect(dispatcher.view(pod.id).runs).toHaveLength(0)
    const change = view.changes!.find(item => item.kind === 'changes' && item.state === 'pending')!
    await master.execute({ type: 'applyChanges', id: change.id, revision: change.revision, conversationId: view.conversation!.id, contextRevision: view.conversation!.revision })
    const applied = store.getPod(pod.id)
    expect(applied).toMatchObject({ lifecycle: 'paused', activeScript: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(dispatcher.view(pod.id).runs).toHaveLength(0)
    expect(new Scheduler(store, dispatcher).view(pod.id)).toMatchObject({ enabled: false, spec: { kind: 'interval', seconds: 900 } })
    dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state, { timeout: 30000 }).toBe('completed')
    expect(dispatcher.view(pod.id).runs[0]).toMatchObject({ scriptHash: applied.activeScript, summary: 'Hello from my pod (1)' })
    expect(store.checkpoint(pod.id).body).toEqual({ count: 1 })
  })

  it('uses the chosen chat model for every provider request of a turn, including tool follow-ups', async () => {
    const turns: { text: string, model: string }[] = []; let calls = 0
    await setup(async (body) => {
      const request = body as { model: string }
      if (JSON.stringify(body).includes('previousDescription')) return answer(JSON.stringify({ description: 'Synthetic description.' }))
      turns.push({ text: JSON.stringify(body).includes('Second turn') ? 'second' : 'first', model: request.model })
      return ++calls === 1 ? recordedResponse({ type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'pods_control', arguments: JSON.stringify({ action: 'create', name: 'Mail knowledge' }) }) : answer('Noted.')
    })
    await master.execute({ type: 'send', id: randomUUID(), text: 'First turn: create a pod.', podId: null, model: 'gpt-6-astra' })
    await idle()
    await master.execute({ type: 'send', id: randomUUID(), text: 'Second turn: explain it.', podId: null, model: 'gpt-5.6-sol' })
    await idle()
    expect(turns.filter(turn => turn.text === 'first').length).toBeGreaterThanOrEqual(2)
    expect(turns).toEqual(turns.map(turn => ({ ...turn, model: turn.text === 'first' ? 'gpt-6-astra' : 'gpt-5.6-sol' })))
  })

  it('starts a fresh provider context after a context change without sending earlier private text', async () => {
    const bodies: string[] = []
    await setup(async (body) => { bodies.push(JSON.stringify(body)); return answer('Review ready.') })
    const filter = store.createPod({ name: 'Mail filter' }); const report = store.createPod({ name: 'Short report' })
    const chats = new ChatRegistry(store); const id = randomUUID()
    chats.execute({ type: 'create', id, title: 'Mail filter and short report', podIds: [filter.id, report.id], workflowId: null, workflowRevision: null })
    await master.execute({ type: 'send', id: randomUUID(), text: 'FILTER_PRIVATE_CONTEXT: Prepare both scripts together.', podId: null, conversationId: id, contextRevision: (await list({ conversationId: id })).conversation!.revision })
    await idle({ conversationId: id })
    expect(bodies.join('\n')).toContain('FILTER_PRIVATE_CONTEXT')
    const conversation = (await list({ conversationId: id })).conversation!
    chats.execute({ type: 'context', id, revision: conversation.revision, podIds: [report.id], workflowId: null, workflowRevision: null })
    const before = bodies.length
    await master.execute({ type: 'send', id: randomUUID(), text: 'Inspect only the selected saved state.', podId: null, conversationId: id, contextRevision: conversation.revision + 1 })
    await idle({ conversationId: id })
    expect(bodies.length).toBeGreaterThan(before)
    expect(bodies.slice(before).join('\n')).not.toContain('FILTER_PRIVATE_CONTEXT')
    // History is kept for the owner even though the model no longer sees it.
    expect((await list({ conversationId: id })).messages.filter(message => message.text.startsWith('FILTER_PRIVATE_CONTEXT'))).toHaveLength(1)
  })
})
