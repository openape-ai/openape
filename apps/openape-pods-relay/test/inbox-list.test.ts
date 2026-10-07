// @vitest-environment happy-dom
import { mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, expect, it } from 'vitest'
import InboxList from '../app/components/InboxList.vue'
import type { InboxItem, Receipt } from '../app/inbox/client'
import { chooseLanguage } from '../app/inbox/i18n'

beforeEach(() => chooseLanguage('de'))
const digest = 'd'.repeat(64)
function decision(change: Partial<NonNullable<InboxItem['decision']>> = {}, item: Partial<InboxItem> = {}): InboxItem {
  return {
    id: crypto.randomUUID(), kind: 'decision', state: 'open', title: 'Newsletter freigeben?', body: 'Eine Mail wartet.', pod: null, runId: null, links: [], created: 1, sequence: 1, read: null, archived: null, deleted: null,
    decision: { sourceId: 'network-choice:1', digest, type: 'network-choice', authority: 'pods', runtimeId: crypto.randomUUID(), options: [{ key: 'approve', title: 'Freigeben', input: null }, { key: 'reject', title: 'Ablehnen', input: null }], ...change },
    ...item,
  }
}
const list = (items: InboxItem[], receipts: Record<string, Receipt> = {}, online = true, pending = {}) => mount(InboxList, { props: { items, receipts, pending, online, actions: true, empty: 'leer' }, global: { stubs: { NuxtLink: RouterLinkStub } } })

it('answers a Pods decision straight from its card', async () => {
  const item = decision()
  const wrapper = list([item])
  expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Freigeben', 'Ablehnen'])
  expect(wrapper.get('[role=group]').attributes('aria-label')).toBe('Antworten auf „Newsletter freigeben?“')
  await wrapper.findAll('button')[1]!.trigger('click')
  expect(wrapper.emitted('decide')).toEqual([[item, 'reject']])
})

it('sends options that need evidence to the detail with the option preselected', () => {
  const item = decision({ options: [{ key: 'deliver', title: 'Zustellen', input: null }, { key: 'seen', title: 'Bereits zugestellt', input: 'evidence' }] })
  const wrapper = list([item])
  expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Zustellen'])
  const links = wrapper.findAllComponents(RouterLinkStub)
  expect(links.at(-1)!.props('to')).toEqual({ path: `/inbox/item/${item.id}`, query: { option: 'seen' } })
})

it('shows the receipt instead of choices while an answer runs, and disables choices offline', () => {
  const item = decision()
  const running = list([item], { [item.id]: { option: 'approve', title: 'Freigeben', digest, requestId: crypto.randomUUID(), state: 'accepted', error: null, at: 1 } })
  expect(running.get('[role=status]').text()).toBe('Angenommen: Freigeben. Wartet auf den Mac; noch nicht angewendet.')
  // The choices stay in the layout but hidden and inert, so the card keeps its height.
  expect(running.get('.quick').classes()).toContain('covered')
  expect(running.get('.quick').attributes('inert')).toBeDefined()
  const offline = list([decision()], {}, false)
  expect(offline.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
})

it('offers no card choices for IdP handoffs or completed decisions', () => {
  const idp = decision({ authority: 'idp', options: [] }, { links: [{ title: 'Freigeben', url: 'https://id.openape.ai/x' }] })
  const done = decision({}, { state: 'resolved' })
  expect(list([idp]).findAll('button')).toHaveLength(0)
  const resolved = list([done])
  expect(resolved.get('.cover').text()).toBe('Erledigt. Diese Entscheidung wartet nicht mehr.')
  expect(resolved.get('.quick').attributes('inert')).toBeDefined()
})

it('puts the sender first and replaces the raw field list with classification hints', () => {
  const item = decision({}, { title: 'Ready to explore this?', body: 'Review uncertain mail · Synthetic company · Mail network\naccount: owner@example.com\ncategory: newsletter\nconfidence: 0.87\nsender: news@example.com\nurgency: normal' })
  const wrapper = list([item])
  const link = wrapper.get('.card-link')
  expect(link.findAll('strong').map(node => node.text())).toEqual(['Absender: news@example.com', 'Ready to explore this?'])
  expect(link.text()).toContain('newsletter · Sicherheit 87 %')
  expect(link.text()).not.toContain('Review uncertain mail')
  const plain = list([decision({}, { body: 'Eine Mail wartet.' })]).get('.card-link')
  expect(plain.findAll('strong')).toHaveLength(1)
  expect(plain.text()).toContain('Eine Mail wartet.')
})

it('offers undo while a tapped answer waits', async () => {
  const item = decision()
  const wrapper = list([item], {}, true, { [item.id]: { option: 'approve', title: 'Freigeben', until: 1 } })
  expect(wrapper.get('.cover').text()).toContain('„Freigeben“ wird gleich gesendet.')
  await wrapper.get('.cover button').trigger('click')
  expect(wrapper.emitted('undo')).toEqual([[item]])
})

it('promotes no sender when a second sender line could be forged', () => {
  const item = decision({}, { body: 'Context\nsender: real@example.com\nnote: hi\nsender: boss@example.com' })
  expect(list([item]).find('.sender').exists()).toBe(false)
})
