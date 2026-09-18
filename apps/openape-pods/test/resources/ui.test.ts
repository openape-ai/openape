import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodResources from '../../src/renderer/PodResources.vue'

const podId = '00000000-0000-4000-8000-000000000001'
const resource = { id: '00000000-0000-4000-8000-000000000002', podId, name: 'Documents', revision: 1, kind: 'directory' as const, state: 'ready' as const, configuration: { path: '/fixture/Documents', access: 'read' } }
describe('pod resource view', () => {
  it('shows exact assigned scope and issues revision-bound revocation', async () => {
    const directories = { home: '/fixture/pod/home', workspace: '/fixture/pod/workspace' }
    const resources = vi.fn().mockResolvedValueOnce({ directories, resources: [resource], epoch: 1 }).mockResolvedValueOnce({ directories, resources: [resource], epoch: 1 }).mockResolvedValueOnce({ directories, resources: [resource], epoch: 1 }).mockResolvedValueOnce({ directories, resources: [{ ...resource, revision: 2, state: 'revoked' }], epoch: 2 })
    window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), getStatus: vi.fn(), onStatus: vi.fn(), workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [{ id: podId, name: 'Pod', revision: 1, lifecycle: 'paused', activeScript: null }] }), resources }
    const wrapper = mount(PodResources, { global: { stubs: { ProgramPermissions: true } } }); await flushPromises()
    expect(wrapper.findAll('.fixed-directory').map(row => row.text())).toEqual([expect.stringContaining('/fixture/pod/home'), expect.stringContaining('/fixture/pod/workspace')])
    expect(wrapper.get('button[aria-label="Remove directory access"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.directory-select').text()).toContain('/fixture/Documents')
    await wrapper.get('button[aria-label="Add directory"]').trigger('click'); await flushPromises()
    expect(resources).toHaveBeenLastCalledWith({ type: 'pickDirectory', podId, epoch: 1 })
    await wrapper.get('select[aria-label="Access for Documents"]').setValue('readWrite'); await flushPromises()
    expect(resources).toHaveBeenLastCalledWith({ type: 'changeDirectory', podId, id: resource.id, revision: 1, epoch: 1, access: 'readWrite' })
    expect((wrapper.get('select[aria-label="Access for Documents"]').element as HTMLSelectElement).value).toBe('read')
    await wrapper.get('.directory-select').trigger('click')
    await wrapper.get('button[aria-label="Remove directory access"]').trigger('click'); await flushPromises()
    expect(resources).toHaveBeenLastCalledWith({ type: 'revoke', podId, id: resource.id, revision: 1 })
    expect(wrapper.find('.directory-select').exists()).toBe(false)
    expect(wrapper.findAll('.fixed-directory')).toHaveLength(2)
    expect(wrapper.get('button[aria-label="Remove directory access"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
