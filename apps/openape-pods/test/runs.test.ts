import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodRuns from '../src/renderer/PodRuns.vue'
import { parseRunCommand, parseRunView } from '../src/contracts/runs'

const podId = '00000000-0000-4000-8000-000000000001'
describe('manual runs view', () => {
  it('selects a bounded example and presents runner failures', async () => {
    const runs = vi.fn().mockResolvedValue({ runs: [], events: [] })
    window.pods = { runs, getStatus: vi.fn(), onStatus: vi.fn(), resources: vi.fn(), workspace: async () => ({ pods: [{ id: podId, name: 'Example pod', assignment: 'Synthetic', revision: 1, lifecycle: 'paused', activeScript: null }] }) }
    const wrapper = mount(PodRuns); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Use local example')!.trigger('click'); await flushPromises()
    expect(runs).toHaveBeenLastCalledWith({ type: 'installExample', podId, variant: 'deterministic' })
    runs.mockRejectedValueOnce(new Error('Script needs validation'))
    await wrapper.findAll('button').find(button => button.text() === 'Start run')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Script needs validation')
    wrapper.unmount()
  })
  it('rejects injected execution authority and malformed persisted events', () => {
    expect(() => parseRunCommand({ type: 'start', podId, executable: '/bin/sh' })).toThrow('Unsupported')
    expect(() => parseRunView({ runs: [], events: [{ sequence: 0, type: 'log', at: 1 }] })).toThrow('event')
    expect(() => parseRunView({ runs: [{ id: podId }], events: [] })).toThrow('record')
  })
})
