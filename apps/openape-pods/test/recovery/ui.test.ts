import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodRuns from '../../src/renderer/PodRuns.vue'
import type { RunEffect } from '../../src/contracts/runs'

const podId = '00000000-0000-4000-8000-000000000001'; const runId = '00000000-0000-4000-8000-000000000002'
describe('explicit recovery UI', () => {
  it('shows unknown outcomes and requires a successful inspection before retrying', async () => {
    const view = { effects: [] as RunEffect[], runs: [{ id: runId, podId, scriptHash: 'a'.repeat(64), state: 'interrupted', startedAt: 1, finishedAt: null, summary: 'Interrupted fixture', error: null, checkpointRevision: 1, recovery: { state: 'needsReview', error: 'External effect is unknown' } }], events: [] }
    const runs = vi.fn().mockImplementation(async (command) => { if (command.action === 'inspect') view.runs[0]!.recovery = { state: 'ready', error: '' }; return structuredClone(view) })
    window.pods = { mcpSession: async () => ({ expiresAt: null, pending: false }), codex: async () => ({ state: 'disconnected' as const, home: '', manual: '' }), definitions: async () => ({ definitions: [], instances: [], provisioning: [] }), domain: async () => ({ namespaces: [], operations: [], questions: [], approvals: [], held: [], unknownEffects: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), runs, workspace: vi.fn().mockResolvedValue({ pods: [{ id: podId, name: 'Fixture', revision: 1, lifecycle: 'paused', activeScript: null }] }), scheduling: vi.fn().mockResolvedValue({ pending: 0, blocked: 1 }), resources: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(PodRuns); await flushPromises()
    const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
    expect(wrapper.text()).toContain('Prepare retry')
    expect(button('Retry unfinished work')).toBeUndefined()
    await button('Prepare retry').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenCalledWith({ type: 'recover', podId, runId, action: 'inspect' })
    expect(button('Retry unfinished work').attributes('disabled')).toBeUndefined()
    await button('Retry unfinished work').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenLastCalledWith({ type: 'recover', podId, runId, action: 'retry' })
    Object.assign(view.runs[0]!, { recovery: null, automaticRecovery: { disposition: 'retry', nextAt: Date.now() + 10000, attempt: 1, reason: 'Automatic retry scheduled' } })
    await wrapper.vm.load(); await flushPromises()
    expect(wrapper.text()).toContain('Automatic retry at')
    expect(button('Prepare retry')).toBeUndefined()
    Object.assign(view.runs[0]!, { automaticRecovery: { disposition: 'isolated', nextAt: null, attempt: 5, reason: 'Automatic attempts exhausted' } })
    await wrapper.vm.load(); await flushPromises()
    expect(wrapper.text()).toContain('Future scheduled runs remain enabled')
    expect(button('Prepare retry')).toBeUndefined()
    expect(button('Run now')).toBeDefined()
    const key = `owner-script:${runId}`
    view.effects = [{ key, runId, authority: { source: 'owner-activation', activationId: 'synthetic-activation', podId, scriptHash: 'a'.repeat(64), assignmentRevision: 1, resourceEpoch: 0 } }]
    await wrapper.vm.load(); await flushPromises()
    expect(button('Observed partial processing').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Recording an observation does not retry the run.')
    await wrapper.get('.http-review textarea').setValue('Synthetic filesystem evidence')
    runs.mockClear()
    await button('Observed partial processing').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenCalledExactlyOnceWith({ type: 'resolveHttp', podId, runId, key, applied: true, programOutcome: 'partial', evidence: 'Synthetic filesystem evidence' })
    runs.mockClear()
    await button('No effects observed').trigger('click'); await flushPromises()
    expect(runs).toHaveBeenCalledExactlyOnceWith({ type: 'resolveHttp', podId, runId, key, applied: false, evidence: 'Synthetic filesystem evidence' })
    wrapper.unmount()
  })
})
