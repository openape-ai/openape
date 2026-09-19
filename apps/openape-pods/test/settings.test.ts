import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodSettings from '../src/renderer/PodSettings.vue'
import type { WorkspaceState } from '../src/contracts/control'

const saved: WorkspaceState = { organization: { revision: 1, groups: [] }, pods: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Orders', revision: 1, lifecycle: 'paused', activeScript: null }] }
describe('local pod settings', () => {
  it('loads saved names, saves revisioned edits and surfaces stale conflicts', async () => {
    const workspace = vi.fn().mockResolvedValueOnce(saved).mockRejectedValueOnce(new Error('Stale pod revision'))
    window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace, getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodSettings); await flushPromises()
    await wrapper.get('.saved-pods button').trigger('click')
    expect(wrapper.find('textarea').exists()).toBe(false); expect(wrapper.text()).not.toContain('Execution assignment')
    await wrapper.get('input').setValue('Renamed')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(workspace).toHaveBeenLastCalledWith({ type: 'update', id: saved.pods[0]!.id, revision: 1, name: 'Renamed', lifecycle: 'paused' })
    expect(wrapper.get('[role="alert"]').text()).toBe('Stale pod revision')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('creates a pod and makes persistence and paused execution explicit', async () => {
    const workspace = vi.fn().mockResolvedValueOnce({ organization: { revision: 1, groups: [] }, pods: [] }).mockResolvedValueOnce(saved)
    window.pods = { packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, defaultOwner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs: async () => ({ runs: [], events: [] }), resources: async () => ({ resources: [], epoch: 0 }), workspace, getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodSettings); await flushPromises()
    await wrapper.get('input').setValue('Orders')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('Settings saved')
    expect(wrapper.get('.saved-pods button').text()).toBe('Orders')
    wrapper.unmount()
  })
})

it('preserves an active pod lifecycle when saving its name', async () => {
  const pod = { ...saved.pods[0]!, lifecycle: 'active' as const }
  const workspace = vi.fn().mockResolvedValue({ ...saved, pods: [pod] })
  window.pods = { workspace } as unknown as typeof window.pods
  const wrapper = mount(PodSettings, { props: { selectedPodId: pod.id }, global: { stubs: { PodSchedule: true, PodValues: true, PodIdentity: true } } }); await flushPromises()
  await wrapper.get('input').setValue('Renamed active pod')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(workspace).toHaveBeenLastCalledWith({ type: 'update', id: pod.id, revision: 1, name: 'Renamed active pod', lifecycle: 'active' })
  wrapper.unmount()
})
