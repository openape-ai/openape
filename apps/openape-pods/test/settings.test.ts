import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodSettings from '../src/renderer/PodSettings.vue'
import type { WorkspaceState } from '../src/contracts/control'

const saved: WorkspaceState = { pods: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Orders', assignment: 'Read assigned order evidence.', revision: 1, lifecycle: 'paused', activeScript: null }] }
describe('local pod settings', () => {
  it('loads saved assignments, saves revisioned edits and surfaces stale conflicts', async () => {
    const workspace = vi.fn().mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('Stale pod revision'))
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace, getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodSettings); await flushPromises()
    await wrapper.get('.saved-pods button').trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Read assigned order evidence.')
    await wrapper.get('textarea').setValue('Read new assignment.')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(workspace).toHaveBeenLastCalledWith({ type: 'update', id: saved.pods[0]!.id, revision: 1, name: 'Orders', assignment: 'Read new assignment.', lifecycle: 'paused' })
    expect(wrapper.get('[role="alert"]').text()).toBe('Stale pod revision')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('creates a pod and makes persistence and paused execution explicit', async () => {
    const workspace = vi.fn().mockResolvedValueOnce({ pods: [] }).mockResolvedValueOnce(saved)
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace, getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodSettings); await flushPromises()
    await wrapper.get('input').setValue('Orders'); await wrapper.get('textarea').setValue('Read assigned order evidence.')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('Automatic execution is paused')
    expect(wrapper.get('.saved-pods button').text()).toBe('Orders')
    wrapper.unmount()
  })
})
