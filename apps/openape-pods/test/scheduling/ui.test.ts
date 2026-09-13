import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodSchedule from '../../src/renderer/PodSchedule.vue'

const pod = { id: '00000000-0000-4000-8000-000000000001', name: 'Synthetic', assignment: 'Read', revision: 1, lifecycle: 'paused' as const, activeScript: null }
const state = { spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }
describe('schedule settings', () => {
  it('defaults to disabled, saves exact scope and requires a separate resume action', async () => {
    const scheduling = vi.fn().mockResolvedValue(state)
    window.pods = { scheduling, runs: vi.fn(), workspace: vi.fn(), resources: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodSchedule, { props: { pod } }); await flushPromises()
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(scheduling).toHaveBeenLastCalledWith({ type: 'save', podId: pod.id, revision: 0, spec: { kind: 'interval', seconds: 3600 }, enabled: false })
    await wrapper.findAll('button').find(button => button.text() === 'Resume automatic execution')!.trigger('click'); await flushPromises()
    expect(scheduling).toHaveBeenLastCalledWith({ type: 'lifecycle', podId: pod.id, revision: 1, lifecycle: 'active' })
    wrapper.unmount()
  })
})
