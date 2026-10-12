// @vitest-environment happy-dom
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import type { InboxItem } from '../app/inbox/client'
import { chooseLanguage } from '../app/inbox/i18n'
import ItemPage from '../app/pages/inbox/item/[id].vue'

const state = reactive({ phase: 'ready', items: {} as Record<string, InboxItem>, receipts: {}, checking: {}, pending: {} })
vi.mock('../app/inbox/client', async original => ({ ...await original<typeof import('../app/inbox/client')>(), useInbox: () => ({ state, load: async () => true, mark: async () => {}, check: async () => {}, answer: async () => {}, undo: () => {} }) }))

beforeEach(() => chooseLanguage('de'))
function item(change: Partial<InboxItem>): InboxItem {
  return { id: crypto.randomUUID(), kind: 'message', state: 'open', decision: null, title: 'Monatsabschluss bereit', body: 'Alle Belege sind abgelegt.', pod: null, runId: null, links: [], created: 1, sequence: 1, read: 1, archived: null, deleted: null, ...change }
}
async function open(shown: InboxItem) {
  state.items = { [shown.id]: shown }
  vi.stubGlobal('useRoute', () => ({ params: { id: shown.id }, query: {} }))
  const wrapper = mount(ItemPage, { global: { stubs: { NuxtLink: RouterLinkStub, InboxShell: { template: '<main><slot /></main>' }, InboxDecision: true } } })
  await flushPromises()
  return wrapper
}

it('shows the Pod tags as chips on message and decision details, and nothing without tags (issue 1463)', async () => {
  const pod = { id: crypto.randomUUID(), name: 'Belege' }
  const message = await open(item({ pod: { ...pod, tags: ['finanzen', 'mail'] } }))
  expect(message.findAll('.tag').map(chip => chip.text())).toEqual(['finanzen', 'mail'])
  expect(message.get('.tags').text()).toBe('Tags: finanzen mail')
  const decision = await open(item({ kind: 'decision', title: 'Rechnung zustellen?', pod: { ...pod, tags: ['finanzen'] } }))
  expect(decision.get('h1').text()).toBe('Rechnung zustellen?')
  expect(decision.findAll('.tag').map(chip => chip.text())).toEqual(['finanzen'])
  for (const untagged of [item({ pod }), item({ pod: { ...pod, tags: [] } }), item({})]) expect((await open(untagged)).find('.tags').exists()).toBe(false)
})
