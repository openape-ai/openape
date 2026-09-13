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
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace: async () => ({ pods: [] }), getStatus: async () => ready, onStatus: (callback) => { listener = callback; return unsubscribe } }
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Ready')
    expect(wrapper.get('button.primary').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('No pods yet')
    expect(wrapper.findAll('.pod-button')).toHaveLength(0)
    await wrapper.get('#tab-Resources').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="tabpanel"]').text()).toContain('No accounts or tools are connected')
    await wrapper.get('.nav-button').trigger('click'); await flushPromises()
    expect(wrapper.get('[aria-label="Master chat"]').text()).toContain('Chat is not connected')
    await wrapper.get('#tab-Overview').trigger('click'); await flushPromises()
    listener({ ...ready, worker: { state: 'error', pid: null, error: 'Worker stopped. Reopen Pods.' } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Reopen Pods')
    wrapper.unmount(); expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('surfaces IPC connection failure instead of claiming readiness', async () => {
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace: async () => ({ pods: [] }), getStatus: async () => { throw new Error('Connection rejected') }, onStatus: () => () => {} }
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('Unavailable')
    expect(wrapper.get('[role="alert"]').text()).toBe('Connection rejected')
    wrapper.unmount()
  })
})
