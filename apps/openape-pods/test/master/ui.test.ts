import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { MasterView } from '../../src/contracts/master'
import { applyLanguage } from '../../src/renderer/i18n'
import MasterChat from '../../src/renderer/MasterChat.vue'

const empty: MasterView = { connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }
describe('reviewable master chat', () => {
  it('sends contextual input, steers the active turn, cancels and keeps permissions as owner proposals', async () => {
    const podId = '00000000-0000-4000-8000-000000000001'
    const view: MasterView = { ...empty, proposals: [{ id: podId, podId, state: 'pending', body: { provider: 'microsoft', description: 'Read synthetic inbox', folders: ['Inbox'] } }], drafts: [{ id: podId, podId, name: 'Mail knowledge', revision: 1, code: 'export async function run() {}', capabilities: [], validation: null, hash: null }] }
    const master = vi.fn().mockImplementation(async (command) => { if (command.type === 'send') view.state = 'running'; if (command.type === 'cancel') view.state = 'interrupted'; if (command.type === 'decline') view.proposals[0]!.state = 'declined'; return structuredClone(view) })
    window.pods = { programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, runtime: { ready: true, error: null } }), master, details: vi.fn(), scheduling: vi.fn(), runs: vi.fn(), resources: vi.fn(), workspace: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
    await wrapper.get('textarea').setValue('Inspect this pod'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', podId, text: 'Inspect this pod' })); expect(wrapper.text()).toContain('Steer the current turn')
    await wrapper.get('textarea').setValue('Stop after inspecting'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'steer', podId }))
    const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
    await button('Cancel turn').trigger('click'); await flushPromises(); expect(master).toHaveBeenCalledWith({ type: 'cancel', podId })
    expect(wrapper.text()).toContain('Unvalidated draft'); expect(wrapper.text()).toContain('export async function run()')
    expect(wrapper.text()).not.toContain('Approve access')
    await button('Review resources').trigger('click'); expect(wrapper.emitted('resources')).toEqual([[podId]])
    await button('Decline').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('declined')
    wrapper.unmount()
  })
  it('retains interrupted history offline and disables sending', async () => {
    window.pods = { programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, runtime: { ready: true, error: null } }), master: vi.fn().mockResolvedValue({ ...empty, connected: false, state: 'interrupted', error: 'Previous action needs inspection', messages: [{ id: '1', role: 'tool', text: '{"result":"created"}', state: 'completed', at: 1 }] }), details: vi.fn(), scheduling: vi.fn(), runs: vi.fn(), resources: vi.fn(), workspace: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(MasterChat, { props: { podId: null } }); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('needs inspection'); expect(wrapper.text()).toContain('created')
    await wrapper.get('textarea').setValue('Continue'); expect(wrapper.get('button.primary').attributes('disabled')).toBeDefined(); wrapper.unmount()
  })
})

it('preserves text composed while an earlier message is sending', async () => {
  let finish!: (view: MasterView) => void
  window.pods = { master: vi.fn().mockImplementation(command => command.type === 'list' ? Promise.resolve(empty) : new Promise<MasterView>((resolve) => { finish = resolve })) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  await wrapper.get('textarea').setValue('First message'); await wrapper.get('form').trigger('submit')
  await wrapper.get('textarea').setValue('Next thought'); finish(empty); await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('Next thought'); wrapper.unmount()
})

it('routes named-secret proposals to the values tab without displaying an input for secret values', async () => {
  const podId = crypto.randomUUID()
  window.pods = { master: vi.fn().mockResolvedValue({ ...empty, proposals: [{ id: crypto.randomUUID(), podId, state: 'pending', body: { provider: 'credential', alias: 'bot_token', description: 'Store your notification token in Variables and secrets' } }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('bot_token'); expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  await wrapper.findAll('button').find(button => button.text() === 'Variables and secrets')!.trigger('click')
  expect(wrapper.emitted('settings')).toEqual([[podId]]); expect(wrapper.emitted('resources')).toBeUndefined()
  applyLanguage('de'); await flushPromises()
  expect(wrapper.text()).toContain('Name des Geheimnisses'); expect(wrapper.text()).toContain('Variablen und Geheimnisse')
  applyLanguage('en'); wrapper.unmount()
})

it('shows the immutable start request separately even outside the recent message window', async () => {
  const initialRequest = { id: 'initial', role: 'user' as const, text: 'Check every 15 minutes', state: 'sent', at: 1 }
  window.pods = { master: vi.fn().mockResolvedValue({ ...empty, initialRequest, messages: [{ ...initialRequest, id: 'later', text: 'Use 30 minutes instead' }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  expect(wrapper.get('.start-request').text()).toContain('Check every 15 minutes')
  expect(wrapper.get('.master-history').text()).toContain('Use 30 minutes instead')
  expect(wrapper.get('.master-history').text()).not.toContain('Check every 15 minutes')
  applyLanguage('de'); await flushPromises(); expect(wrapper.get('.start-request').text()).toContain('Startauftrag')
  applyLanguage('en'); wrapper.unmount()
})

it('keeps unsent drafts separate between creation conversations', async () => {
  window.pods = { master: vi.fn().mockResolvedValue(empty) } as unknown as typeof window.pods
  const one = mount(MasterChat, { props: { podId: null, creationId: crypto.randomUUID() } }); await flushPromises()
  await one.get('textarea').setValue('First creation draft'); one.unmount()
  const two = mount(MasterChat, { props: { podId: null, creationId: crypto.randomUUID() } }); await flushPromises()
  expect(two.get('textarea').element.value).toBe(''); two.unmount()
})
