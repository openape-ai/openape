import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'

const podId = '00000000-0000-4000-8000-000000000001'
const resource = { id: '00000000-0000-4000-8000-000000000002', podId, name: 'Reference.txt', revision: 1, kind: 'reference' as const, state: 'ready' as const, configuration: { path: '/fixture/Reference.txt' } }
describe('pod resource view', () => {
  it('shows exact assigned scope and issues revision-bound revocation', async () => {
    const resources = vi.fn().mockResolvedValueOnce({ resources: [resource], epoch: 1 }).mockResolvedValueOnce({ resources: [{ ...resource, revision: 2, state: 'revoked' }], epoch: 2 })
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), getStatus: vi.fn(), onStatus: vi.fn(), workspace: async () => ({ pods: [{ id: podId, name: 'Pod', assignment: 'Read', revision: 1, lifecycle: 'paused', activeScript: null }] }), resources }
    const wrapper = mount(PodResources); await flushPromises()
    expect(wrapper.get('.resource-path').text()).toBe('/fixture/Reference.txt')
    await wrapper.get('.resource-row button').trigger('click'); await flushPromises()
    expect(resources).toHaveBeenLastCalledWith({ type: 'revoke', podId, id: resource.id, revision: 1 })
    expect(wrapper.get('.resource-row').text()).toContain('revoked')
    expect(wrapper.get('.resource-row button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
