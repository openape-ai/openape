import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PodRuns from '../src/renderer/PodRuns.vue'
import { parseRunCommand, parseRunView } from '../src/contracts/runs'

const podId = '00000000-0000-4000-8000-000000000001'
describe('manual runs view', () => {
  it('starts the saved script and presents runner failures', async () => {
    const runs = vi.fn().mockResolvedValue({ runs: [], events: [] })
    window.pods = { codex: async () => ({ state: 'disconnected' as const, home: '', manual: '' }), chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }), master: async () => ({ connected: false, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }), details: async () => ({ claims: [], total: 0, counts: { finding: 0, question: 0, gap: 0 }, checkpointRevision: 0, versions: [], source: null }), scheduling: async () => ({ spec: null, enabled: false, revision: 0, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }), runs, getStatus: vi.fn(), onStatus: vi.fn(), resources: vi.fn(), workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: [{ id: podId, name: 'Example pod', revision: 1, lifecycle: 'paused', activeScript: null }] }) }
    const wrapper = mount(PodRuns); await flushPromises()
    expect(wrapper.text()).not.toContain('Use local example')
    runs.mockRejectedValueOnce(new Error('Script needs validation'))
    await wrapper.findAll('button').find(button => button.text() === 'Run now')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('This run could not finish')
    wrapper.unmount()
  })
  it('rejects injected execution authority and malformed persisted events', () => {
    expect(() => parseRunCommand({ type: 'start', podId, executable: '/bin/sh' })).toThrow('Unsupported')
    expect(() => parseRunView({ runs: [], events: [{ sequence: 0, type: 'log', at: 1 }] })).toThrow('event')
    expect(() => parseRunView({ runs: [{ id: podId }], events: [] })).toThrow('record')
  })
})

it('opens the verified pending grant and keeps JSON diagnostics secondary', async () => {
  const { default: RunApproval } = await import('../src/renderer/RunApproval.vue')
  const runId = '00000000-0000-4000-8000-000000000002'
  const runs = vi.fn().mockResolvedValue({ runs: [], events: [] })
  window.pods = { ...window.pods, runs }
  const wrapper = mount(RunApproval, { props: { podId, approvals: [{ runId, grantId: 'synthetic', issuer: 'https://id.example.test', state: 'pending', title: 'Run the stored script', openError: 'The browser could not be opened; use Open approval to try again' }] } })
  expect(wrapper.text()).toContain('Waiting for your approval')
  expect(wrapper.text()).toContain('browser could not be opened')
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(runs).toHaveBeenCalledWith({ type: 'openApproval', podId, runId, grantId: 'synthetic' })
  expect(() => parseRunCommand({ type: 'openApproval', podId, runId, grantId: 'synthetic', url: 'https://evil.test' })).toThrow()
  wrapper.unmount()
})

it('derives elapsed time and activity from observed events without inventing model or delivery steps', async () => {
  const { runActivity, runTiming, runFailure } = await import('../src/renderer/run-activity')
  const events = [
    { sequence: 1, at: 1000, type: 'started', data: {} },
    { sequence: 2, at: 2000, type: 'approval', data: { grantId: 'a', state: 'pending' } },
    { sequence: 3, at: 3000, type: 'approval', data: { grantId: 'a', state: 'pending' } },
    { sequence: 4, at: 5000, type: 'approval', data: { grantId: 'a', state: 'approved' } },
    { sequence: 5, at: 6000, type: 'operation', data: { id: 'o', operation: 'tools.invoke', state: 'started' } },
    { sequence: 6, at: 7000, type: 'operation', data: { id: 'o', operation: 'tools.invoke', state: 'completed' } },
  ]
  expect(runTiming(events, 1000, 10000)).toEqual({ active: '0:06', waiting: '0:03' })
  expect(runActivity(events).map(item => item.title)).toEqual(['Run prepared', 'Permission review', 'Application call'])
  expect(runFailure('Script failed: {"message":"Identity authorization failed (400)"}')?.help).toContain('does not mean')
})

it('summarizes repeated work without approval noise and explains the Codex storage interruption', async () => {
  const { runSteps, runFailure } = await import('../src/renderer/run-activity')
  const events = Array.from({ length: 5 }, (_, index) => [
    { sequence: index * 3 + 1, at: index, type: 'operation', data: { id: String(index), operation: 'tools.invoke', state: 'started' } },
    { sequence: index * 3 + 2, at: index, type: 'approval', data: { permission: 'o365.account[email=private@example.test].mail-read[*]#read', state: 'approved' } },
    { sequence: index * 3 + 3, at: index, type: 'operation', data: { id: String(index), operation: 'tools.invoke', state: 'completed' } },
  ]).flat()
  expect(runSteps(events)).toEqual([{ title: 'Application call', application: 'o365', completed: 5, failed: 0, running: 0 }])
  events.push({ sequence: 16, at: 6, type: 'operation', data: { id: 'ai', operation: 'agent.run', state: 'started' } })
  expect(runSteps(events, 'cancelled')[1]).toMatchObject({ title: 'AI request', completed: 0, failed: 1, running: 0 })
  const failure = runFailure('Data inventory contains a link or unsupported file: runs/run/agent/confined/home/codex/tmp/arg0/fixture/apply_patch')
  expect(failure?.title).toContain('Pods stopped')
  expect(failure?.action).toBeUndefined()
  expect(runFailure('Permission revoked')?.action).toBe('permissions')
  expect(runFailure('OpenApe rejected this Pod identity')?.action).toBe('identity')
})
