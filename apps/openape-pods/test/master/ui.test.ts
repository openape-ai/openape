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
    window.pods = { runtimeApproval: async () => ({ enabled: false }), codex: async () => ({ state: 'disconnected' as const, home: '', manual: '' }), chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }), master, details: vi.fn(), scheduling: vi.fn(), runs: vi.fn(), resources: vi.fn(), workspace: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
    await wrapper.get('textarea').setValue('Inspect this pod'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', podId, text: 'Inspect this pod' })); expect(wrapper.text()).toContain('Thinking…')
    await wrapper.get('textarea').setValue('Stop after inspecting'); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'steer', podId }))
    const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
    await wrapper.get('button[aria-label="Stop response"]').trigger('click'); await flushPromises(); expect(master).toHaveBeenCalledWith({ type: 'cancel', podId })
    expect(wrapper.text()).toContain('Unvalidated draft'); expect(wrapper.text()).toContain('export async function run()')
    expect(wrapper.text()).not.toContain('Approve access')
    await button('Review resources').trigger('click'); expect(wrapper.emitted('resources')).toEqual([[podId]])
    await button('Decline').trigger('click'); await flushPromises(); expect(wrapper.text()).toContain('declined')
    wrapper.unmount()
  })
  it('retains interrupted history offline and disables sending', async () => {
    window.pods = { runtimeApproval: async () => ({ enabled: false }), codex: async () => ({ state: 'disconnected' as const, home: '', manual: '' }), chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding: async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }), master: vi.fn().mockResolvedValue({ ...empty, connected: false, state: 'interrupted', error: 'Previous action needs inspection', messages: [{ id: '1', role: 'tool', text: '{"result":"created"}', state: 'completed', at: 1 }] }), details: vi.fn(), scheduling: vi.fn(), runs: vi.fn(), resources: vi.fn(), workspace: vi.fn(), getStatus: vi.fn(), onStatus: vi.fn() }
    const wrapper = mount(MasterChat, { props: { podId: null } }); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('needs inspection'); expect(wrapper.text()).toContain('created')
    await wrapper.get('textarea').setValue('Continue'); expect(wrapper.get('button.primary').attributes('disabled')).toBeDefined(); wrapper.unmount()
  })
})

it('preserves text composed while an earlier message is sending', async () => {
  let finish!: (view: MasterView) => void
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master: vi.fn().mockImplementation(command => command.type === 'list' ? Promise.resolve(empty) : new Promise<MasterView>((resolve) => { finish = resolve })) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  await wrapper.get('textarea').setValue('First message'); await wrapper.get('form').trigger('submit')
  await wrapper.get('textarea').setValue('Next thought'); finish(empty); await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('Next thought'); wrapper.unmount()
})

it('routes named-secret proposals to the values tab without displaying an input for secret values', async () => {
  const podId = crypto.randomUUID()
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master: vi.fn().mockResolvedValue({ ...empty, proposals: [{ id: crypto.randomUUID(), podId, state: 'pending', body: { provider: 'credential', alias: 'bot_token', description: 'Store your notification token in Variables and secrets' } }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('bot_token'); expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  await wrapper.findAll('button').find(button => button.text() === 'Variables and secrets')!.trigger('click')
  expect(wrapper.emitted('settings')).toEqual([[podId, 'bot_token']]); expect(wrapper.emitted('resources')).toBeUndefined()
  applyLanguage('de'); await flushPromises()
  expect(wrapper.text()).toContain('Name des Geheimnisses'); expect(wrapper.text()).toContain('Variablen und Geheimnisse')
  applyLanguage('en'); wrapper.unmount()
})

it('keeps the original request once in the conversation even outside the recent message window', async () => {
  const initialRequest = { id: 'initial', role: 'user' as const, text: 'Check every 15 minutes', state: 'sent', at: 1 }
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master: vi.fn().mockResolvedValue({ ...empty, initialRequest, messages: [{ ...initialRequest, id: 'later', text: 'Use 30 minutes instead' }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  expect(wrapper.find('.start-request').exists()).toBe(false)
  expect(wrapper.findAll('.master-message.user')).toHaveLength(2)
  expect(wrapper.get('.master-history').text()).toContain('Check every 15 minutes')
  expect(wrapper.get('.master-history').text()).toContain('Use 30 minutes instead')
  expect(wrapper.text()).not.toContain('Start request')
  applyLanguage('de'); await flushPromises(); expect(wrapper.text()).not.toContain('Startauftrag')
  applyLanguage('en'); wrapper.unmount()
})

it('keeps unsent drafts separate between creation conversations', async () => {
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master: vi.fn().mockResolvedValue(empty) } as unknown as typeof window.pods
  const one = mount(MasterChat, { props: { podId: null, creationId: crypto.randomUUID() } }); await flushPromises()
  await one.get('textarea').setValue('First creation draft'); one.unmount()
  const two = mount(MasterChat, { props: { podId: null, creationId: crypto.randomUUID() } }); await flushPromises()
  expect(two.get('textarea').element.value).toBe(''); two.unmount()
})

it('keeps technical activity collapsed and renders the initial message only once', async () => {
  const initialRequest = { id: 'first', role: 'user' as const, text: 'Prepare a summary', state: 'sent', at: 1 }
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master: vi.fn().mockResolvedValue({ ...empty, initialRequest, messages: [initialRequest, { id: 'tool', role: 'tool', text: 'Synthetic technical result', state: 'completed', at: 2 }, { id: 'reply', role: 'assistant', text: 'Your summary is ready.', state: 'completed', at: 3 }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  expect(wrapper.findAll('.master-message.user')).toHaveLength(1)
  expect(wrapper.get('.master-history').text()).toBe('Prepare a summaryYour summary is ready.')
  expect(wrapper.get('.chat-details').attributes('open')).toBeUndefined()
  expect(wrapper.get('.chat-details').text()).toContain('Synthetic technical result')
  expect(wrapper.text()).not.toContain('Pod action')
  wrapper.unmount()
})

it('sends on Enter, preserves Shift+Enter and composition, and rejects duplicate or offline sends', async () => {
  let finish!: (view: MasterView) => void
  const master = vi.fn().mockImplementation(command => command.type === 'list' ? Promise.resolve(empty) : new Promise<MasterView>((resolve) => { finish = resolve }))
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  const input = wrapper.get('textarea')
  await input.setValue('A new message')
  await input.trigger('keydown', { key: 'Enter', shiftKey: true })
  await input.trigger('keydown', { key: 'Enter', isComposing: true })
  expect(master.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(0)
  await input.trigger('keydown', { key: 'Enter' })
  await input.trigger('keydown', { key: 'Enter' })
  expect(master.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(1)
  finish({ ...empty, connected: false }); await flushPromises()
  await input.setValue('Keep this draft offline'); await input.trigger('keydown', { key: 'Enter' })
  expect(master.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(1)
  expect(input.element.value).toBe('Keep this draft offline')
  wrapper.unmount()
})

it('persists the chosen creation model and sends the exact model ID', async () => {
  localStorage.removeItem('pods-chat-model')
  const master = vi.fn().mockResolvedValue(empty)
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master } as unknown as typeof window.pods
  let wrapper = mount(MasterChat, { props: { podId: null, creationId: crypto.randomUUID() } }); await flushPromises()
  await wrapper.get('button[aria-label="Chat model"]').trigger('click'); await flushPromises()
  await wrapper.get('#chat-model-gpt-6-astra').trigger('click'); await flushPromises()
  await wrapper.get('textarea').setValue('Create the invoice pod')
  await wrapper.get('form.master-compose').trigger('submit'); await flushPromises()
  expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', model: 'gpt-6-astra' }))
  wrapper.unmount()
  wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  expect(wrapper.get('button[aria-label="Chat model"]').text()).toContain('GPT-6 Astra')
  wrapper.unmount(); localStorage.removeItem('pods-chat-model')
})

it('filters slash commands and models without sending a command or losing the surrounding draft', async () => {
  const master = vi.fn().mockResolvedValue(empty)
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() }, attachTo: document.body }); await flushPromises()
  const input = wrapper.get('textarea')
  await input.setValue('/')
  expect(wrapper.get('[aria-label="Chat commands"][role="listbox"]').text()).toContain('/model')
  await input.setValue('Keep this draft /mo after the cursor')
  input.element.setSelectionRange(19, 19); await input.trigger('input')
  await input.trigger('keydown', { key: 'Enter' }); await flushPromises()
  const search = wrapper.get('input[aria-label="Search models"]')
  expect(document.activeElement).toBe(search.element)
  await search.setValue('astra'); await flushPromises()
  expect(wrapper.findAll('.model-options [role="option"]')).toHaveLength(1)
  await search.trigger('keydown', { key: 'Enter', isComposing: true })
  expect(wrapper.find('.composer-palette').exists()).toBe(true)
  await search.trigger('keydown', { key: 'Enter' }); await flushPromises()
  expect(input.element.value).toBe('Keep this draft  after the cursor')
  expect(document.activeElement).toBe(input.element)
  expect(wrapper.get('button[aria-label="Chat model"]').text()).toContain('GPT-6 Astra')
  expect(master.mock.calls.every(([command]) => command.type === 'list')).toBe(true)
  wrapper.unmount(); localStorage.removeItem('pods-chat-model')
})

it('keeps slash cancellation, empty searches and literal paths out of model changes', async () => {
  const master = vi.fn().mockResolvedValue(empty)
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  const input = wrapper.get('textarea')
  await input.setValue('/model'); await input.trigger('keydown', { key: 'Escape' })
  expect(input.element.value).toBe('/model'); expect(wrapper.find('.composer-palette').exists()).toBe(false)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  const search = wrapper.get('input[aria-label="Search models"]')
  await search.setValue('no-such-model'); await search.trigger('keydown', { key: 'Enter' })
  expect(wrapper.text()).toContain('No matching models')
  expect(master.mock.calls.every(([command]) => command.type === 'list')).toBe(true)
  await search.trigger('keydown', { key: 'Escape' })
  expect(input.element.value).toBe('/model')
  await input.setValue('Read /tmp/model.txt'); expect(wrapper.find('.composer-palette').exists()).toBe(false)
  await input.trigger('keydown', { key: 'Enter' }); await flushPromises()
  expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'send', text: 'Read /tmp/model.txt', model: 'gpt-5.5' }))
  wrapper.unmount()
})

it('supports keyboard model navigation and locks selection during an active response', async () => {
  let state = { ...empty }
  const master = vi.fn().mockImplementation(async (command) => { if (command.type === 'send') state = { ...state, state: 'running' }; return state })
  window.pods = { runtimeApproval: async () => ({ enabled: false }), master } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  const input = wrapper.get('textarea')
  await input.setValue('/'); await input.trigger('keydown', { key: 'Tab' }); await flushPromises()
  const search = wrapper.get('input[aria-label="Search models"]')
  await search.trigger('keydown', { key: 'Home' }); await search.trigger('keydown', { key: 'ArrowDown' })
  await search.trigger('keydown', { key: 'Enter' }); await flushPromises()
  expect(wrapper.get('button[aria-label="Chat model"]').text()).toContain('GPT-5.6 Sol')
  await input.setValue('Start a response'); await input.trigger('keydown', { key: 'Enter' }); await flushPromises()
  await input.setValue('/model'); await input.trigger('keydown', { key: 'Enter' }); await flushPromises()
  await wrapper.get('input[aria-label="Search models"]').setValue('astra')
  await wrapper.get('input[aria-label="Search models"]').trigger('keydown', { key: 'Enter' }); await flushPromises()
  expect(wrapper.get('#chat-model-gpt-6-astra').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('Wait for the current response')
  expect(wrapper.get('button[aria-label="Chat model"]').text()).toContain('GPT-5.6 Sol')
  expect(master.mock.calls.filter(([command]) => command.type === 'send' || command.type === 'steer')).toHaveLength(1)
  wrapper.unmount(); localStorage.removeItem('pods-chat-model')
})
