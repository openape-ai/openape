import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodRuns from '../../src/renderer/PodRuns.vue'

const podId = '00000000-0000-4000-8000-000000000001'; const runId = '00000000-0000-4000-8000-000000000002'
describe('explicit recovery UI', () => {
  it('shows unknown outcomes and requires a successful inspection before retrying', async () => {
    const view = { runs: [{ id: runId, podId, scriptHash: 'a'.repeat(64), state: 'interrupted', startedAt: 1, finishedAt: null, summary: 'Interrupted fixture', error: null, checkpointRevision: 1, recovery: { state: 'needsReview', error: 'External effect is unknown' } }], events: [] }
    const runs = vi.fn().mockImplementation(async (command) => { if (command.action === 'inspect') view.runs[0]!.recovery = { state: 'ready', error: '' }; return structuredClone(view) })
    window.pods = { details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), runs, workspace: vi.fn().mockResolvedValue({ pods: [{ id: podId, name: 'Fixture', assignment: 'Synthetic only', revision: 1, lifecycle: 'paused', activeScript: null }] }), scheduling: vi.fn().mockResolvedValue({ pending: 0, blocked: 1 }), resources: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodRuns); await flushPromises()
    const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
    expect(wrapper.text()).toContain('External effect is unknown')
    expect(button('Retry remaining inputs').attributes('disabled')).toBeDefined()
    await button('Check stopped execution').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenCalledWith({ type: 'recover', podId, runId, action: 'inspect' })
    expect(button('Retry remaining inputs').attributes('disabled')).toBeUndefined()
    await button('Retry remaining inputs').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenLastCalledWith({ type: 'recover', podId, runId, action: 'retry' })
    wrapper.unmount()
  })
})
