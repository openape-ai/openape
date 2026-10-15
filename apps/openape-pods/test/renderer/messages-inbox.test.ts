import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import type { InboxMessage } from '../../src/contracts/inbox'
import MessagesInbox from '../../src/renderer/central/MessagesInbox.vue'
import { applyLanguage } from '../../src/renderer/i18n'

const now = Date.UTC(2026, 9, 15, 9)
const message = (id: number, fields: Partial<InboxMessage> = {}): InboxMessage => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, title: `Message ${id}`, body: 'Body', pod: { id: '00000000-0000-4000-8000-000000000001', name: 'Briefing', tags: ['ops'] },
  runId: null, links: [], created: now - id * 60000, read: null, archived: null, ...fields,
})
afterEach(() => applyLanguage('en'))

function setup(messages: InboxMessage[]) {
  const wrapper = mount(MessagesInbox, { props: { messages, now } })
  const button = (text: string) => wrapper.findAll('button').find(item => item.text().startsWith(text))
  return { wrapper, button }
}

it('lists inbox messages newest first and renders only https links', () => {
  const { wrapper } = setup([
    message(2, { links: [{ title: 'Script', url: 'javascript:alert(1)' }, { title: 'Plain', url: 'http://example.test/' }, { title: 'Report', url: 'https://example.test/r' }] }),
    message(1),
    message(3, { archived: now }),
  ])
  expect(wrapper.findAll('[data-message] .subj').map(item => item.text())).toEqual(['Message 1', 'Message 2'])
  expect(wrapper.findAll('a').map(item => item.attributes('href'))).toEqual(['https://example.test/r'])
})

it('asks before bulk actions and applies them only to the counted messages', async () => {
  const messages = [message(1), message(2, { read: now })]
  const { wrapper, button } = setup(messages)
  await button('Archive all (2)')!.trigger('click')
  expect(wrapper.text()).toContain('Archive all 2 messages?')
  expect(wrapper.emitted('mark')).toBeUndefined()
  await button('Cancel')!.trigger('click')
  expect(wrapper.emitted('mark')).toBeUndefined()

  await button('Mark all as read (1)')!.trigger('click')
  // A message arriving while the question is open is not part of the confirmed action.
  await wrapper.setProps({ messages: [message(0), ...messages] })
  await button('Mark as read')!.trigger('click'); await flushPromises()
  expect(wrapper.emitted('mark')).toEqual([[{ type: 'mark', id: messages[0]!.id, read: true }]])
})

it('archives all as read and deletes from the archive only after confirmation', async () => {
  const unread = message(1)
  const { wrapper, button } = setup([unread, message(2, { read: now, archived: now })])
  await button('Archive all (1)')!.trigger('click')
  await wrapper.findAll('.bulk-confirm button')[0]!.trigger('click')
  expect(wrapper.emitted('mark')).toEqual([[{ type: 'mark', id: unread.id, archived: true, read: true }]])

  await button('Archive')!.trigger('click')
  const archived = wrapper.get('[data-message]')
  expect(archived.text()).not.toContain('Mark as unread')
  await archived.findAll('button').find(item => item.text() === 'Delete')!.trigger('click')
  expect(wrapper.emitted('mark')).toHaveLength(1)
  expect(archived.text()).toContain('Delete permanently?')
  await archived.findAll('button').find(item => item.text() === 'Delete')!.trigger('click')
  expect(wrapper.emitted('mark')![1]).toEqual([{ type: 'mark', id: message(2).id, deleted: true }])
})
