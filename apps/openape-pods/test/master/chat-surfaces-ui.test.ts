import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ChatsPanel from '../../src/renderer/ChatsPanel.vue'
import MasterChat from '../../src/renderer/MasterChat.vue'
import PodDescription from '../../src/renderer/PodDescription.vue'
import type { Conversation, ChatsView } from '../../src/contracts/chats'
import type { AccessProposal, MasterView } from '../../src/contracts/master'
import { applyLanguage } from '../../src/renderer/i18n'

// Chat behaviour formerly asserted by the packaged `chat-setup`, `prompt-setup`
// and `chats` E2E files that no existing component test covered.
const podId = '00000000-0000-4000-8000-000000000001'
const idle: MasterView = { connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }
afterEach(() => applyLanguage('en'))
const pending = (body: AccessProposal['body']): AccessProposal => ({ id: crypto.randomUUID(), podId, body, state: 'pending' })

it('explains how to obtain a Telegram bot token and routes the secret to Variables and secrets, never to the chat', async () => {
  const token = pending({ provider: 'credential', alias: 'telegram_bot_token', description: 'Store the bot token securely' })
  window.pods = { master: vi.fn().mockResolvedValue({ ...idle, proposals: [token] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('In Telegram, open @BotFather.')
  expect(wrapper.findAll('input[type="password"]')).toHaveLength(0)
  await wrapper.findAll('button').find(button => button.text() === 'Variables and secrets')!.trigger('click')
  expect(wrapper.emitted('settings')).toEqual([[podId, 'telegram_bot_token']])
  wrapper.unmount()
})

it('keeps Continue setup unavailable while the model provider is disconnected', async () => {
  window.pods = { master: vi.fn().mockResolvedValue({ ...idle, connected: false, state: 'interrupted', scriptState: 'missing' }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('No script has been saved for this pod yet.')
  expect(wrapper.findAll('button').find(button => button.text() === 'Continue setup')!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('marks a description generated from the pod conversation', async () => {
  applyLanguage('de')
  window.pods = { master: vi.fn().mockResolvedValue({ description: { text: 'Writes a greeting file.', state: 'ready', error: null, revision: 1, updatedAt: 1 } }) } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('Writes a greeting file.')
  expect(wrapper.text()).toContain('Aus diesem Chat erstellt')
  wrapper.unmount()
})

it('renames a central chat against the revision the owner saw', async () => {
  const id = '00000000-0000-4000-8000-000000000002'
  const conversation: Conversation = { id, title: 'New chat', scope: `chat:${id}`, revision: 4, originPodId: null, updatedAt: 1, context: { pods: [], podIds: [], workflow: null }, workflowChanged: false, unavailablePodIds: [], relatedPodIds: [], relatedWorkflowIds: [] }
  const view: ChatsView = { conversations: [conversation], activeConversationId: null }
  const chats = vi.fn().mockResolvedValue(view)
  window.pods = { chats, master: vi.fn().mockResolvedValue({ ...idle, conversation }) } as unknown as typeof window.pods
  const wrapper = mount(ChatsPanel, { props: { view, pods: [], workflows: { workflows: [], runs: [] }, selectedId: id } }); await flushPromises()
  await wrapper.get('input[aria-label="Chat title"]').setValue('Mail filter and short report')
  await (wrapper.get('input[aria-label="Chat title"]').element as HTMLInputElement).form!.dispatchEvent(new Event('submit')); await flushPromises()
  expect(chats).toHaveBeenCalledWith({ type: 'rename', id, revision: 4, title: 'Mail filter and short report' })
  wrapper.unmount()
})
