import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PodStatus } from '../src/contracts/ipc'
import App from '../src/renderer/App.vue'

const ready: PodStatus = { version: 1, mode: 'fixture', executionEnabled: true, worker: { state: 'ready', pid: 42, error: null }, runtime: { electron: '40.9.3', node: '24.14.1' } }
afterEach(() => vi.unstubAllGlobals())
describe('pod workspace shell', () => {
  it('shows actual worker updates, contextual navigation and manual execution navigation', async () => {
    let listener = (_status: PodStatus) => {}
    const unsubscribe = vi.fn()
    window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [] }), getStatus: async () => ready, onStatus: (callback) => { listener = callback; return unsubscribe } }
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).toEqual(['Overview', 'Chat', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History'])
    expect(wrapper.text()).toContain('No pods yet')
    expect(wrapper.findAll('.pod-button')).toHaveLength(0)
    await wrapper.get('#tab-Permissions').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Create a local pod')
    await wrapper.get('#tab-Chat').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Connect Codex')
    await wrapper.get('#tab-Overview').trigger('click'); await flushPromises()
    listener({ ...ready, worker: { state: 'error', pid: null, error: 'Worker stopped. Reopen Pods.' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Reopen Pods')
    wrapper.unmount(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('guides a stopped run from Overview to recovery without queueing a new start', async () => {
    const podId = '00000000-0000-4000-8000-000000000001'
    const run = { id: '00000000-0000-4000-8000-000000000002', podId, scriptHash: 'a'.repeat(64), state: 'cancelled', startedAt: 1, finishedAt: 2, summary: '', error: 'Storage limit reached', checkpointRevision: 0 }
    const runs = vi.fn().mockResolvedValue({ runs: [run], events: [] })
    window.pods = {
      chats: async () => ({ conversations: [], activeConversationId: null }),
      workflows: async () => ({ workflows: [], runs: [] }),
      runs, getStatus: async () => ready, onStatus: () => () => {},
      workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [{ id: podId, name: 'Fixture', revision: 1, lifecycle: 'paused', activeScript: run.scriptHash }] }),
      details: async () => ({ counts: {}, claims: [], versions: [] }), resources: async () => ({ resources: [] }),
      scheduling: async () => ({ enabled: false, pending: 0, blocked: 0 }),
      onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }),
      data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }),
    } as unknown as typeof window.pods
    const wrapper = mount(App); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Prepare retry')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('Check whether this run can be retried safely')
    expect(runs.mock.calls.every(([command]) => command.type === 'list')).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === 'Open App settings')!.trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('App settings')
    expect(wrapper.find('#panel-History').exists()).toBe(false)
    wrapper.unmount()
  })
  it('surfaces IPC connection failure instead of claiming readiness', async () => {
    window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [] }), getStatus: async () => { throw new Error('Connection rejected') }, onStatus: () => () => {} }
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Unavailable')
    expect(wrapper.get('[role="alert"]').text()).toBe('Connection rejected')
    wrapper.unmount()
  })
})

it('starts a fresh creation chat when New pod is clicked again', async () => {
  localStorage.removeItem('pods-creation-id')
  const master = vi.fn().mockResolvedValue({ connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] })
  window.pods = { master, getStatus: async () => ready, onStatus: () => () => {}, workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [] }) } as unknown as typeof window.pods
  const wrapper = mount(App); await flushPromises()
  try {
    await wrapper.get('.new-pod').trigger('click'); await flushPromises()
    await wrapper.get('textarea').setValue('An unfinished first request')
    await wrapper.get('.new-pod').trigger('click'); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('')
    const beginnings = master.mock.calls.filter(([command]) => command.type === 'begin')
    expect(beginnings).toHaveLength(2)
    expect(beginnings[0][0].id).not.toBe(beginnings[1][0].id)
    await wrapper.get('textarea').setValue('The second request')
    await wrapper.get('form.master-compose').trigger('submit'); await flushPromises()
    expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', creationId: beginnings[1][0].id, text: 'The second request' }))
  }
  finally { wrapper.unmount(); localStorage.removeItem('pods-creation-id') }
})
