import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ChatsPanel from '../../src/renderer/ChatsPanel.vue'
import MasterChat from '../../src/renderer/MasterChat.vue'
import type { Conversation, ChatsView } from '../../src/contracts/chats'
import type { MasterView } from '../../src/contracts/master'

const podId = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const pod = { id: podId, name: 'Filter <script>untrusted</script>', revision: 1, lifecycle: 'paused' as const, activeScript: null }
const conversation: Conversation = { id, title: 'Mail review', scope: `chat:${id}`, revision: 1, originPodId: null, updatedAt: 1, context: { pods: [{ id: podId, name: pod.name }], podIds: [podId], workflow: null }, workflowChanged: false, unavailablePodIds: [], relatedPodIds: [podId], relatedWorkflowIds: [] }
const view: ChatsView = { conversations: [conversation], activeConversationId: null }
const master: MasterView = { conversation, connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }
it('shows explicit selection, previews removal and submits the reviewed revision despite concurrent refresh', async () => {
  const chats = vi.fn().mockImplementation(async (command) => { structuredClone(command); return view })
  window.pods = { chats, master: vi.fn().mockResolvedValue(master) } as unknown as typeof window.pods
  const wrapper = mount(ChatsPanel, { props: { view, pods: [pod], workflows: { workflows: [], runs: [] }, selectedId: id } }); await flushPromises()
  expect(wrapper.text()).toContain(pod.name); expect(wrapper.find('script').exists()).toBe(false)
  await wrapper.get('button[aria-label="Add context"]').trigger('click')
  await wrapper.get('input[type=checkbox]').setValue(false)
  expect(wrapper.text()).toContain('Removed from future model context'); expect(wrapper.text()).toContain('Context changes start fresh')
  expect(chats).not.toHaveBeenCalled()
  await wrapper.setProps({ view: { ...view, conversations: [{ ...conversation, revision: 2 }] } })
  await wrapper.get('dialog form').trigger('submit'); await flushPromises()
  expect(chats).toHaveBeenCalledWith({ type: 'context', id, revision: 1, podIds: [], workflowId: null, workflowRevision: null })
  wrapper.unmount()
})
it('blocks a second turn and offers the running conversation without cancelling it', async () => {
  const other = '00000000-0000-4000-8000-000000000003'
  const request = vi.fn().mockResolvedValue({ ...master, activeConversationId: other })
  window.pods = { master: request } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: null, conversationId: id } }); await flushPromises()
  await wrapper.get('textarea').setValue('Please continue')
  expect(wrapper.get('button[aria-label=Send]').attributes('disabled')).toBeDefined()
  await wrapper.findAll('button').find(button => button.text() === 'Open chat')!.trigger('click')
  expect(wrapper.emitted('openChat')).toEqual([[other]])
  expect(request.mock.calls.every(([command]) => command.type === 'list')).toBe(true)
  wrapper.unmount()
})
it('does not turn an assistant claim into a saved-change receipt', async () => {
  window.pods = { master: vi.fn().mockResolvedValue({ ...master, messages: [{ id: 'claim', role: 'assistant', state: 'completed', text: 'Everything was saved and run.', at: 1 }] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: null, conversationId: id } }); await flushPromises()
  expect(wrapper.text()).toContain('Everything was saved and run.')
  expect(wrapper.text()).not.toContain('Applied with a saved receipt')
  expect(wrapper.findAll('button').some(button => button.text() === 'Apply changes together')).toBe(false)
  wrapper.unmount()
})

it('names the failed target while retaining an unapplied review', async () => {
  const change = { id, conversationId: id, contextRevision: 1, revision: 1, kind: 'changes', state: 'pending', targets: [{ podId, name: 'Mail filter', base: 'before', before: {}, actions: [], review: [], draftHashes: {} }], results: [], error: 'Pod configuration changed; inspect the current state and prepare this change again', errorPodId: podId }
  window.pods = { master: vi.fn().mockResolvedValue({ ...master, changes: [change] }) } as unknown as typeof window.pods
  const wrapper = mount(MasterChat, { props: { podId: null, conversationId: id } }); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Mail filter:')
  expect(wrapper.get('[role="alert"]').text()).toContain('changed')
  expect(wrapper.text()).not.toContain('Applied with a saved receipt')
  wrapper.unmount()
})
