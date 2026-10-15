// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import InboxDecision from '../app/components/InboxDecision.vue'
import type { InboxItem, Receipt } from '../app/inbox/client'
import { chooseLanguage } from '../app/inbox/i18n'

beforeEach(() => chooseLanguage('de'))
const digest = 'b'.repeat(64)
function decision(change: Partial<InboxItem['decision']> = {}, item: Partial<InboxItem> = {}): InboxItem {
  return {
    id: crypto.randomUUID(),
    kind: 'decision',
    state: 'open',
    title: 'Zustellen?',
    body: 'Eine Mail wartet.',
    pod: null,
    runId: null,
    links: [],
    created: 1,
    sequence: 1,
    read: null,
    archived: null,
    deleted: null,
    decision: { sourceId: 'effect:1', digest, type: 'question', authority: 'pods', runtimeId: crypto.randomUUID(), options: [{ key: 'yes', title: 'Zustellen', input: null }, { key: 'seen', title: 'Bereits erledigt', input: 'evidence' }], ...change },
    ...item,
  }
}
const receipt = (state: Receipt['state'], error: string | null = null): Receipt => ({ option: 'yes', title: 'Zustellen', digest, requestId: crypto.randomUUID(), state, error, at: 1 })
const buttons = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('button').map(button => button.text())

it('sends a plain option on tap and asks for evidence before an option that needs it', async () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: undefined, online: true, checking: false } })
  await wrapper.get('button:first-of-type').trigger('click')
  expect(wrapper.emitted('decide')).toEqual([['yes']])

  await wrapper.findAll('button')[1]!.trigger('click')
  expect(wrapper.emitted('decide')).toHaveLength(1)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.text()).toContain('Bitte zuerst ausfüllen.')
  expect(wrapper.emitted('decide')).toHaveLength(1)
  await wrapper.get('textarea').setValue('Am Telefon bestätigt')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('decide')![1]).toEqual(['seen', 'Am Telefon bestätigt'])
})

it('offers no active choice while offline and explains why', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: undefined, online: false, checking: false } })
  expect(wrapper.text()).toContain('Entscheiden ist nur online möglich.')
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
})

it('shows acceptance and start as not applied and hides the choices meanwhile', () => {
  for (const state of ['accepted', 'started'] as const) {
    const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: receipt(state), online: true, checking: false } })
    expect(wrapper.get('[role=status]').text()).toMatch(/noch nicht angewendet/)
    expect(buttons(wrapper)).toEqual(['Status prüfen'])
  }
  const applied = mount(InboxDecision, { props: { item: decision(), receipt: receipt('applied'), online: true, checking: false } })
  expect(applied.get('[role=status]').text()).toBe('Angewendet: Zustellen.')
  expect(buttons(applied)).toEqual([])
})

it('after an uncertain send offers only the unchanged resend', async () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: receipt('unsent', 'network'), online: true, checking: false } })
  expect(wrapper.text()).toContain('Nicht sicher gesendet: Zustellen. Keine Verbindung.')
  expect(buttons(wrapper)).toEqual(['Erneut senden'])
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('decide')).toEqual([['yes']])
})

it('offers no new choice after an unclear outcome for the same version', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: receipt('unknown'), online: true, checking: false } })
  expect(wrapper.text()).toContain('Ergebnis unklar: Zustellen. Bitte am Mac prüfen.')
  expect(buttons(wrapper)).toEqual([])
  const changed = mount(InboxDecision, { props: { item: decision({ digest: 'c'.repeat(64) }), receipt: receipt('unknown'), online: true, checking: false } })
  expect(buttons(changed)).toEqual(['Zustellen', 'Bereits erledigt'])
})

it('ignores a stored handoff link that is not HTTPS', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision({ authority: 'idp', options: [] }, { links: [{ title: 'x', url: 'javascript:alert(1)' }] }), receipt: undefined, online: true, checking: false } })
  expect(wrapper.find('a').exists()).toBe(false)
})

it('explains a refusal and offers the current choices again', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: receipt('refused', 'pod_offline'), online: true, checking: false } })
  expect(wrapper.text()).toContain('Der Mac ist gerade nicht verbunden')
  expect(buttons(wrapper)).toEqual(['Zustellen', 'Bereits erledigt'])
})

it('hands IdP approvals to the identity provider and desktop-only steps to the Mac', () => {
  const idp = mount(InboxDecision, { props: { item: decision({ authority: 'idp', options: [] }, { links: [{ title: 'Freigeben', url: 'https://id.openape.ai/grant/1' }] }), receipt: undefined, online: true, checking: false } })
  const link = idp.get('a')
  expect(link.attributes()).toMatchObject({ href: 'https://id.openape.ai/grant/1', target: '_blank', rel: 'noopener noreferrer' })
  expect(link.text()).toBe('In OpenApe ID öffnen')
  expect(buttons(idp)).toEqual([])

  const desktop = mount(InboxDecision, { props: { item: decision({ options: [] }), receipt: undefined, online: true, checking: false } })
  expect(desktop.text()).toContain('Dieser Schritt geht nur am Mac in OpenApe Pods.')
  expect(buttons(desktop)).toEqual([])
})

it('shows a resolved decision as completed without any control', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision({}, { state: 'resolved' }), receipt: undefined, online: true, checking: false } })
  expect(wrapper.text()).toContain('Erledigt. Diese Entscheidung wartet nicht mehr.')
  expect(buttons(wrapper)).toEqual([])
})

it('speaks English when chosen', () => {
  chooseLanguage('en')
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: receipt('accepted'), online: true, checking: false } })
  expect(wrapper.get('[role=status]').text()).toBe('Accepted: Zustellen. Waiting for the Mac; not applied yet.')
})

it('opens with the evidence form when the option was picked on the list card', () => {
  const wrapper = mount(InboxDecision, { props: { item: decision(), receipt: undefined, online: true, checking: false, preselect: 'seen' } })
  expect(wrapper.find('textarea').exists()).toBe(true)
  expect(mount(InboxDecision, { props: { item: decision(), receipt: undefined, online: true, checking: false, preselect: 'yes' } }).find('form').exists()).toBe(false)
})

it.each(['work', 'effect', 'approval'])('replaces %s recovery choices with a copyable repair prompt, including offline', async (type) => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const item = decision({ type }, { pod: { id: crypto.randomUUID(), name: 'Intake' }, body: 'Application is quitting', runId: crypto.randomUUID() })
  const wrapper = mount(InboxDecision, { props: { item, receipt: undefined, online: false, checking: false } })
  expect(buttons(wrapper)).toEqual(['Prompt kopieren'])
  await wrapper.get('button').trigger('click')
  await flushPromises()
  const prompt = writeText.mock.calls[0]![0]
  expect(prompt).toContain('Lies zuerst runtime')
  expect(prompt).toContain('Wiederhole keine möglicherweise ausgeführte Aktion blind')
  for (const value of [item.id, item.pod!.id, item.runId, item.decision!.runtimeId, item.decision!.sourceId, item.body]) expect(prompt).toContain(value)
  expect(wrapper.text()).toContain('Prompt kopiert')
  expect(wrapper.text()).toContain('Der Fehler bleibt bis zur erfolgreichen Behebung offen.')
  expect(wrapper.emitted('decide')).toBeUndefined()
  expect(item.state).toBe('open')
  await wrapper.setProps({ item: { ...item, body: 'Updated error' } })
  expect(buttons(wrapper)).toEqual(['Prompt kopieren'])
  wrapper.unmount()
  vi.unstubAllGlobals()
})

it('provides selectable text when clipboard access fails and copies in the chosen language', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
  chooseLanguage('en')
  const wrapper = mount(InboxDecision, { props: { item: decision({ type: 'work' }), receipt: receipt('unknown'), online: true, checking: false } })
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toContain('Copying failed')
  expect(wrapper.get('details').attributes('open')).toBeDefined()
  expect(wrapper.get('textarea').element.value).toContain('Investigate and fix')
  expect(wrapper.get('textarea').element.value).toContain('"state": "unknown"')
  expect(wrapper.get('textarea').attributes('readonly')).toBeDefined()
  expect(wrapper.emitted('decide')).toBeUndefined()
  wrapper.unmount()
  vi.unstubAllGlobals()
})
