import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { GateBatchView } from '../../src/contracts/gates'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import type { NetworkGateView } from '../../src/contracts/network-gate-view'
import type { NetworkChoiceView } from '../../src/contracts/networks'
import type { AccessProposal } from '../../src/contracts/master'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import DecisionsInbox from '../../src/renderer/central/DecisionsInbox.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { chooseGate, choiceEvents, choicePayload } from './choice-events'
import fixture from './map-view.json'

// The Entscheidungen surface from the 17 recorded choice events of the installed app and the fixture's rights and deliveries.
const view = parseMapView(fixture) as MapView
const network = view.collections.find(collection => collection.kind === 'network' && !collection.bounded)!
/** The 17 events as the network engine lists them: ordered by acceptance, two cases carry a second version. */
export const choices: NetworkChoiceView[] = [...choiceEvents].sort((a, b) => Date.parse(a[6]) - Date.parse(b[6])).map(recorded => ({ networkId: network.id, revision: network.revision, eventId: recorded[0], caseId: `${recorded[1]}-0000-4000-8000-000000000000`.slice(0, 36), gate: chooseGate.key, title: chooseGate.title, payload: JSON.stringify(choicePayload(recorded)), truncated: false, options: chooseGate.options.map(({ key, title }) => ({ key, title })) }))
const batch: NetworkGateView = { id: '00000000-0000-4000-8000-0000000000b1', networkId: network.id, gate: 'newsletter-approval', podId: network.members[9]!, generation: 1, state: 'pending', expiresAt: view.at + 3600000, url: 'https://id.openape.ai/grant-approval?grant_id=batch-1', error: null, items: [{ deliveryId: '00000000-0000-4000-8000-0000000000d1', title: 'Nur heute: 20 % · news@shop.example', outcome: 'held' }, { deliveryId: '00000000-0000-4000-8000-0000000000d2', title: 'Neu im Oktober · hello@saas.example', outcome: 'held' }] }
const proposal: AccessProposal = { id: '00000000-0000-4000-8000-0000000000a1', podId: view.pods.find(pod => pod.name === 'zaz Service-Agent')!.id, body: { provider: 'http', description: 'Reach https://zaz.delta-mind.at with GET and POST', origin: 'https://zaz.delta-mind.at', methods: ['GET', 'POST'] }, state: 'pending' }
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
async function mountInbox(props: Record<string, unknown> = {}) {
  applyLanguage('de')
  wrapper = mount(DecisionsInbox, { attachTo: document.body, props: { view, choices, gates: [], graphGates: null, proposals: [], desktop: true, ...props } })
  await flushPromises()
  return wrapper
}

describe('Entscheidungen', () => {
  it('renders the 17 events as 15 cases with versions, generic payload fields and the four ways of the gate', async () => {
    await mountInbox()
    const kpis = wrapper!.findAll('.kpi').map(item => [item.find('b').text(), item.find('span').text(), item.find('small').text()])
    expect(kpis).toEqual([
      ['17', 'Rückfragen', 'in 15 Fällen · Delta Mind · Mail-Netzwerk'],
      ['0', 'Freigaben', 'keine wartenden Batches'],
      ['1', 'Rechte', '1 Laufzeit-Anfragen'],
      ['1', 'unklare Zustellungen', '1 Zustellungen abzugleichen'],
      ['0', 'Einrichtung', 'keine Vorschläge'],
    ])
    const cards = wrapper!.findAll('[data-testid="choices"] .item')
    expect(cards).toHaveLength(15)
    expect(wrapper!.find('.gatehead').text()).toContain('Review uncertain mail')
    expect(wrapper!.find('.gatehead').text()).toContain('nimmt mail.unsure · 4 Wege: Keep for review, Newsletter candidate, Invoice review, Reply preview · 15 offen')
    const versions = cards.filter(card => card.text().includes('2 Fassungen'))
    expect(versions).toHaveLength(2)
    expect(versions.every(card => card.text().includes('Diesen Donnerstag: ATS Convention - jetzt noch anmelden!'))).toBe(true)
    const github = cards.find(card => card.text().includes('Dependabot'))!
    expect(github.find('.subj').text()).toBe('[GitHub] Your Dependabot alerts for the week of Sep 29 - Oct 6')
    const facts = Object.fromEntries(github.findAll('dt').map((dt, index) => [dt.text(), github.findAll('dd')[index]!.text()]))
    expect(facts).toMatchObject({ account: 'phofmann@delta-mind.at', category: 'useful', complete: 'nein', confidence: '0,89', knownContact: 'nein', protected: 'nein', sender: 'noreply@github.com', urgency: 'normal' })
    expect(facts.evidence).toMatch(/^ed32bc79ed32…$/)
    expect(facts.date).toMatch(/06\.10\., \d\d:\d\d/)
    expect(Object.keys(facts)).not.toContain('subject')
    expect(github.findAll('.opts button').map(item => item.text())).toEqual(['Keep for review', 'Newsletter candidate', 'Invoice review', 'Reply preview'])
    expect(github.find('.auth').text()).toContain('Review uncertain mail')
    expect(github.find('.auth').text()).toContain('mail.unsure · Fall 80d48713')
  })

  it('emits one choose command per case with the chosen option key and shows the decided card', async () => {
    await mountInbox()
    const github = wrapper!.findAll('[data-testid="choices"] .item').find(card => card.text().includes('Dependabot'))!
    await github.findAll('.opts button')[0]!.trigger('click')
    expect(wrapper!.emitted('network')).toEqual([[{ type: 'choose', id: network.id, revision: network.revision, eventId: 'ed32bc79', gate: 'uncertain-review', option: 'keep' }]])
    const done = wrapper!.find('[data-testid="choices"] .item.done')
    expect(done.text()).toContain('Keep for review')
    expect(done.text()).toContain('→ mail.useful')
    expect(wrapper!.findAll('.kpi')[0]!.find('b').text()).toBe('16')
    // The ATS case has two versions; choosing decides its latest event once.
    const ats = wrapper!.findAll('[data-testid="choices"] .item').find(card => card.text().includes('2 Fassungen'))!
    await ats.findAll('.opts button')[1]!.trigger('click')
    expect(wrapper!.emitted('network')!.at(-1)).toEqual([{ type: 'choose', id: network.id, revision: network.revision, eventId: expect.stringMatching(/^(551b9282|61b04af6)$/), gate: 'uncertain-review', option: 'newsletter' }])
    expect(wrapper!.findAll('.kpi')[0]!.find('b').text()).toBe('14')
  })

  it('groups cases by a payload field and decides a whole group with single commands', async () => {
    await mountInbox()
    const select = wrapper!.find('.ctrls select')
    expect(select.findAll('option').map(item => item.text())).toEqual(['–', 'account', 'category', 'complete', 'confidence', 'knownContact', 'protected', 'sender', 'urgency'])
    await select.setValue('sender')
    const groups = wrapper!.findAll('.grp')
    expect(groups[0]!.find('.pill').text()).toBe('sender = invitations@linkedin.com')
    expect(groups[0]!.text()).toContain('4 Fälle')
    const all = groups[0]!.findAll('.row .opts button').map(item => item.text())
    expect(all).toEqual(['alle: Keep for review', 'alle: Newsletter candidate', 'alle: Invoice review', 'alle: Reply preview'])
    await groups[0]!.findAll('.row .opts button')[3]!.trigger('click')
    expect(wrapper!.emitted('network')).toHaveLength(4)
    expect(wrapper!.emitted('network')!.every(([command]) => (command as { option: string, gate: string }).option === 'reply' && (command as { gate: string }).gate === 'uncertain-review')).toBe(true)
    expect(wrapper!.findAll('.grp')[0]!.findAll('.row .opts button')).toHaveLength(0)
    await wrapper!.find('.ctrls input[type="checkbox"]').setValue(true)
    expect(wrapper!.find('[data-testid="choices"] .item:not(.done) .raw').text()).toContain('"gate": "uncertain-review"')
  })

  it('lists approval batches with the IdP action, rights with the approval command, unknown deliveries and setup proposals', async () => {
    const monitor = view.pods.find(pod => pod.name === 'IURIO PR monitor')!
    const bot = view.pods.find(pod => pod.unknown.length)!
    await mountInbox({ gates: [batch], proposals: [proposal] })
    const batches = wrapper!.find('[data-testid="batches"]')
    expect(batches.text()).toContain('Freigabe-Batch · newsletter-approval')
    expect(batches.text()).toContain('2 Items')
    expect(batches.find('button.idp').text()).toBe('Am IdP entscheiden')
    await batches.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await batches.find('label input:not([type="checkbox"])').setValue('Werbung, nicht relevant')
    await batches.findAll('button').find(item => item.text() === 'Ausgewählte ausschließen')!.trigger('click')
    expect(wrapper!.emitted('network')).toEqual([[{ type: 'gateExclude', id: network.id, revision: network.revision, taskId: batch.id, generation: 1, deliveryIds: [batch.items[0]!.deliveryId], evidence: 'Werbung, nicht relevant' }]])
    const rights = wrapper!.find('[data-testid="rights"]')
    expect(rights.text()).toContain('IURIO PR monitor')
    expect(rights.text()).toContain('Execution permission for IURIO PR monitor')
    await rights.find('button').trigger('click')
    expect(wrapper!.emitted('command')).toEqual([[{ channel: 'runs', body: { type: 'openApproval', podId: monitor.id, runId: monitor.approvals[0]!.runId, grantId: 'grant-pr-monitor' } }]])
    const deliveries = wrapper!.find('[data-testid="deliveries"]')
    expect(deliveries.text()).toContain(bot.name)
    expect(deliveries.find('button').attributes('disabled')).toBeDefined()
    await deliveries.find('label input').setValue('Nachricht 245 ist im Kanal angekommen')
    await deliveries.findAll('button')[0]!.trigger('click')
    expect(wrapper!.emitted('command')!.at(-1)).toEqual([{ channel: 'runs', body: { type: 'resolveHttp', podId: bot.id, runId: bot.unknown[0]!.runId, key: bot.unknown[0]!.key, applied: true, evidence: 'Nachricht 245 ist im Kanal angekommen' } }])
    const setup = wrapper!.find('[data-testid="setup"]')
    expect(setup.text()).toContain('zaz Service-Agent')
    expect(setup.text()).toContain('Reach https://zaz.delta-mind.at with GET and POST')
    await setup.findAll('button').find(item => item.text() === 'Im Pod einrichten')!.trigger('click')
    expect(wrapper!.emitted('open')).toEqual([[proposal.podId]])
    await setup.findAll('button').find(item => item.text() === 'Ablehnen')!.trigger('click')
    expect(wrapper!.emitted('master')).toEqual([[{ type: 'decline', id: proposal.id, podId: proposal.podId }]])
    expect(wrapper!.findAll('.kpi').map(item => item.find('b').text())).toEqual(['17', '1', '1', '1', '1'])
  })

  it.each([true, false])('opens network and graph approvals on the correct host (desktop: %s)', async (desktop) => {
    const graphBatch: GateBatchView = { id: '00000000-0000-4000-8000-0000000000b2', workflowId: '00000000-0000-4000-8000-0000000000f1', gate: 'review', podId: batch.podId, state: 'pending', url: 'https://id.openape.ai/grant-approval?grant_id=graph-batch', expiresAt: batch.expiresAt, error: null, items: [] }
    await mountInbox({ desktop, gates: [batch], graphGates: { batches: [graphBatch], held: [] } })
    const actions = wrapper!.findAll('[data-testid="batches"] .opts .idp')
    expect(actions).toHaveLength(2)
    if (!desktop) {
      for (const [index, url] of [batch.url, graphBatch.url].entries()) {
        expect(actions[index]!.element.tagName).toBe('A')
        expect(actions[index]!.attributes()).toMatchObject({ href: url, target: '_blank', rel: 'noopener' })
      }
      expect(wrapper!.emitted('network')).toBeUndefined()
      expect(wrapper!.emitted('workflow')).toBeUndefined()
      return
    }
    for (const action of actions) { expect(action.element.tagName).toBe('BUTTON'); await action.trigger('click') }
    expect(wrapper!.emitted('network')).toEqual([[{ type: 'gateOpen', id: network.id, revision: network.revision, taskId: batch.id, generation: batch.generation }]])
    expect(wrapper!.emitted('workflow')).toEqual([[{ type: 'gateOpen', batchId: graphBatch.id }]])
  })

  it('shows the inbox on the second tab of the shell with the count in the tab and opens a Pod from a proposal', async () => {
    applyLanguage('de')
    wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: true, now: view.at, desktop: true, tab: 'decisions', inbox: { choices, gates: [], graphGates: null, proposals: [proposal] } } })
    await flushPromises()
    expect(wrapper.find('[role="tablist"]').text()).toContain('Entscheidungen 20')
    expect(wrapper.find('.decisions-inbox h1').text()).toBe('Entscheidungen')
    await wrapper.findAll('[data-testid="choices"] .opts button')[0]!.trigger('click')
    expect(wrapper.emitted('networkCommand')).toHaveLength(1)
    await wrapper.findAll('button').find(item => item.text() === 'Im Pod einrichten')!.trigger('click')
    expect(wrapper.emitted('update:tab')).toEqual([['automations']])
  })

  it('lists open secret requests under setup with the fill link, cancels them on the desktop and hides settled ones', async () => {
    const bot = view.pods.find(pod => pod.name === 'Morgenbriefing · Calendar-Bot')!
    const row = { podId: bot.id, alias: 'calendar_bot_token', purpose: '', expiresAt: view.at + 86400000, createdAt: view.at, updatedAt: view.at, error: null }
    await mountInbox({ requests: [{ ...row, id: '01REQ0', status: 'requested' }, { ...row, id: '01REQ1', status: 'failed', error: 'The envelope was collected elsewhere' }, { ...row, id: '01REQ2', status: 'collected' }, { ...row, id: '01REQ3', status: 'expired' }], secretsOrigin: 'https://secrets.openape.ai' })
    const items = wrapper!.findAll('[data-testid="secret-request"]')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Geheimnis calendar_bot_token für Morgenbriefing · Calendar-Bot')
    expect(items[0]!.text()).toContain('ohne Zweckangabe'); expect(items[0]!.text()).toContain('gültig 24 h'); expect(items[0]!.text()).toContain('Anfrage 01REQ0')
    expect(items[0]!.find('a').attributes('href')).toBe('https://secrets.openape.ai')
    expect(items[1]!.text()).toContain('fehlgeschlagen'); expect(items[1]!.text()).toContain('Der Umschlag wurde anderswo abgeholt'); expect(items[1]!.find('a').exists()).toBe(false)
    const total = (wrapper!.vm as unknown as { total: number }).total
    await items[0]!.find('button').trigger('click')
    expect(wrapper!.emitted('secrets')).toEqual([[{ type: 'cancel', id: '01REQ0' }]])
    wrapper!.unmount()
    await mountInbox({ requests: [{ ...row, id: '01REQ0', status: 'requested' }], desktop: false })
    expect(wrapper!.find('[data-testid="secret-request"] button').attributes('disabled')).toBeDefined()
    expect((wrapper!.vm as unknown as { total: number }).total).toBe(total - 1)
  })
})
