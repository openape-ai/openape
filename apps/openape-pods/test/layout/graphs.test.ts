import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { StoredPod } from '../../src/contracts/control'
import type { GraphDetail, GraphGate } from '../../src/contracts/graphs'
import type { WorkflowDefinition, WorkflowView } from '../../src/contracts/workflows'
import { sequenceParts } from '../../src/contracts/workflows'
import App from '../../src/renderer/App.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import BrowserWorkspace from '../../src/renderer/central/BrowserWorkspace.vue'
import { browserFixture } from '../workspace/browser-fixture'
import GraphView from '../../src/renderer/GraphView.vue'
import { applyLanguage, t } from '../../src/renderer/i18n'
import { screenshotPath } from './evidence'
import { installWorkspace } from './workspace-fixture'
import { operationalFixture, recoveryFixture, conversionFixture } from './network-fixture'

// Geometry of the graph view with the production stylesheet and the component's own rules.
// Text, states and events are asserted in test/scheduling/graph-ui.test.ts.
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const id = (index: number) => `00000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`
const names = ['Posteingang', 'Gesendet', 'Listen-Filter', 'Triage', 'Kategorisierung mit einem absichtlich langen Namen', 'Rechnungen ablegen', 'Gedächtnis', 'Archivieren']
const pods: StoredPod[] = names.map((name, index) => ({ id: id(index), name, revision: 1, lifecycle: 'paused', activeScript: 'e'.repeat(64) }))
const [intake, sent, lists, triage, categorise, invoices, memory, archive] = pods.map(pod => pod.id) as [string, string, string, string, string, string, string, string]
const group = id(40); const graphId = id(50)
const gates: GraphGate[] = [
  { key: 'newsletter', title: 'Sammel-Grant Werbung', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: 'mail.useful' },
  { key: 'review', title: 'Prüfen', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'useful', title: 'Sinnvoll', channel: 'mail.useful' }, { key: 'newsletter', title: 'Werbung', channel: 'mail.newsletter' }] },
]
const contracts = {
  [intake]: { takes: [], gives: ['mail.new'], summary: 'neue Mails holen' },
  [sent]: { takes: [], gives: ['mail.sent'], summary: 'gesendete Mails holen' },
  [lists]: { takes: ['mail.new'], gives: ['mail.newsletter', 'mail.useful', 'mail.open'], summary: 'White- und Blacklist' },
  [triage]: { takes: ['mail.open'], gives: ['mail.newsletter', 'mail.useful', 'mail.unsure'], summary: 'Werbung oder sinnvoll' },
  [categorise]: { takes: ['mail.useful'], gives: ['mail.invoice', 'mail.other'], summary: 'Rechnung, Projekt, Info' },
  [invoices]: { takes: ['mail.invoice'], gives: ['invoice.filed'], summary: 'PDF in Buchhaltung' },
  [memory]: { takes: ['mail.other', 'mail.sent', 'invoice.filed'], gives: [], summary: 'Obsidian-Notizen' },
  [archive]: { takes: ['mail.approved'], gives: [], summary: 'nur freigegebene Mails' },
}
const channels = [...new Set(Object.values(contracts).flatMap(contract => [...contract.takes, ...contract.gives]))]
const definition: WorkflowDefinition = { ...sequenceParts, id: graphId, revision: 1, name: 'E-Mail-Management', nodes: pods.map(pod => ({ podId: pod.id, after: [], handoff: false })), schedule: { kind: 'interval', seconds: 3600 }, enabled: true, paused: false, nextAt: null, mode: 'channels', groupId: group, channels: channels.map(name => ({ name, title: name === 'mail.open' ? 'Neue offene Mails' : name, fields: [] })), gates, values: [] }
const nodes = [...pods.map(pod => ({ id: pod.id, ...contracts[pod.id]! })), { id: 'gate:newsletter', takes: ['mail.newsletter'], gives: ['mail.approved', 'mail.useful'] }, { id: 'gate:review', takes: ['mail.unsure'], gives: ['mail.useful', 'mail.newsletter'] }]
const edges = nodes.flatMap(from => nodes.flatMap(to => from.gives.filter(channel => to.takes.includes(channel)).map(channel => ({ from: from.id, to: to.id, channel }))))
const batch = { id: id(60), workflowId: graphId, gate: 'newsletter', podId: archive, state: 'pending' as const, url: 'https://id.example.test/grant-approval?grant_id=one', expiresAt: 1_790_040_000_000, error: null, items: ['Nur heute: 20 % auf alles · news@shop.example', 'Neu im September: 5 Funktionen · hello@saas-tool.example', 'Frühbucher endet am Freitag · events@konferenz.example'].map((title, index) => ({ itemId: id(70 + index), key: `mail-${index}`, title, excluded: false })) }
const detail: GraphDetail = {
  workflowId: graphId, contracts, edges,
  nodeKinds: { [intake]: 'code', [sent]: 'code', [lists]: 'code', [triage]: 'decision', [categorise]: 'decision', [invoices]: 'effect', [memory]: 'effect', [archive]: 'effect', 'gate:newsletter': 'gate', 'gate:review': 'gate' },
  diagnostics: [], rights: { [archive]: [{ label: 'Move approved mail', target: 'pods-mail' }], [invoices]: [{ label: 'Folder, read and write', target: '/Users/fixture/Documents/Buchhaltung/Eingangsrechnungen/2026' }] },
  lastRun: { id: id(80), startedAt: 1_790_000_000_000, state: 'completed' },
  counts: [{ from: intake, to: lists, channel: 'mail.new', count: 42 }, { from: lists, to: triage, channel: 'mail.open', count: 23 }, { from: lists, to: 'gate:newsletter', channel: 'mail.newsletter', count: 11 }, { from: triage, to: 'gate:newsletter', channel: 'mail.newsletter', count: 14 }, { from: triage, to: categorise, channel: 'mail.useful', count: 9 }, { from: categorise, to: invoices, channel: 'mail.invoice', count: 3 }],
  waiting: { 'gate:newsletter': 25, 'gate:review': 1 },
  items: [{ key: 'mail-0', title: 'Nur heute: 20 % auf alles · news@shop.example', outcome: 'held', node: 'gate:newsletter' }, { key: 'mail-9', title: 'Rechnung 2026-0917 · buchhaltung@lieferant.example', outcome: 'consumed', node: invoices }],
  trace: null,
}
const trace = { key: 'mail-0', title: 'Nur heute: 20 % auf alles · news@shop.example', events: [{ node: intake, outcome: 'emitted', channel: 'mail.new', reason: null, confidence: null, at: 1 }, { node: lists, outcome: 'consumed', channel: 'mail.new', reason: null, confidence: null, at: 2 }, { node: lists, outcome: 'emitted', channel: 'mail.open', reason: 'Absender steht auf keiner Liste', confidence: null, at: 3 }, { node: triage, outcome: 'emitted', channel: 'mail.newsletter', reason: 'Werbung, Rabattaktion ohne persönliche Anrede', confidence: 0.97, at: 4 }, { node: 'gate:newsletter', outcome: 'held', channel: 'mail.newsletter', reason: null, confidence: null, at: 5 }] }
const view: WorkflowView = { workflows: [definition], runs: [], gates: { batches: [batch], held: [{ itemId: id(90), workflowId: graphId, gate: 'review', key: 'mail-7', title: 'Kurze Frage zu eurem Angebot · partner@agentur.example' }] }, contracts }

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en') })
const rectangles = (selector: string) => Array.from(document.querySelectorAll(selector)).map(element => element.getBoundingClientRect())

describe('graph view on its own', () => {
  it('lets no node overlap another and fits a 390 pixel viewport by scrolling inside its container', async () => {
    await page.viewport(390, 844)
    const host = document.createElement('div'); host.style.padding = '0 16px'; document.body.append(host)
    wrapper = mount(GraphView, { attachTo: host, props: { definition, detail, pods, mode: 'run' } }); await frame()
    const boxes = rectangles('.graph-node')
    expect(boxes).toHaveLength(10)
    for (const box of boxes) { expect(box.width).toBe(176); expect(box.height).toBe(64) }
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'two nodes overlap').toBe(true)
    }
    const scroll = document.querySelector<HTMLElement>('.graph-scroll')!
    expect(scroll.scrollWidth, 'the drawing is wider than the phone').toBeGreaterThan(390)
    expect(scroll.getBoundingClientRect().right, 'the container stays inside the window').toBeLessThanOrEqual(390 - 16)
    expect(document.documentElement.scrollWidth, 'the page does not scroll sideways').toBeLessThanOrEqual(390)
    scroll.scrollLeft = scroll.scrollWidth; await frame()
    const last = Math.max(...rectangles('.graph-node').map(box => box.right))
    expect(last, 'the last column can be scrolled into view').toBeLessThanOrEqual(scroll.getBoundingClientRect().right)
    host.remove()
  })
})

describe.each(['local', 'connected'] as const)('graph pages in the %s desktop', (surface) => {
  async function open(language: 'de' | 'en' = 'de') {
    installWorkspace({
      language: async () => language,
      central: async command => command.type === 'status' ? { enabled: true, state: 'online', runtimeId: id(99) } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } },
      workspace: async () => ({ organization: { revision: 1, groups: [{ id: group, name: 'Delta Mind', collapsed: false, podIds: pods.map(pod => pod.id) }] }, pods: structuredClone(pods) }),
      workflows: async command => structuredClone({ ...view, ...command.type === 'graph' ? { graph: { ...detail, trace: command.key ? trace : null } } : {} }),
    })
    applyLanguage(language)
    wrapper = mount(surface === 'connected' ? DesktopWorkspace : App, { attachTo: document.body }); await flushPromises(); await frame()
  }
  const click = async (text: string) => { await (wrapper!.findAll('button').find(button => button.text() === text) ?? wrapper!.findAll('button').find(button => button.text().includes(text)))!.trigger('click'); await flushPromises(); await frame() }
  const shot = async (name: string) => { expect(document.documentElement.scrollWidth, `${name}: page overflow`).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(`graphs-${surface}-${name}.png`) }) }

  it('shows overview, structure, last run, item trace, approval and creation without widening the page', async () => {
    await page.viewport(1280, 900)
    await open()
    await shot('overview')
    await click('E-Mail-Management')
    await wrapper!.findAll('.graph-node').find(node => node.text().includes('Triage'))!.trigger('click'); await frame()
    expect(document.querySelector('.graph-inspector h2')!.textContent).toBe('Triage')
    await shot('blueprint')
    await click('Letzte Ausführung')
    expect(rectangles('.graph-count').length).toBe(6)
    const unused = document.querySelector<SVGPathElement>('.graph-edges path[data-active="false"]')!
    expect(getComputedStyle(unused).opacity).toBe('0.45')
    expect(getComputedStyle(unused).strokeDasharray).toBe('4px, 4px')
    await shot('last-run')
    await click('Nur heute: 20 % auf alles')
    expect(document.querySelectorAll('.item-trace li')).toHaveLength(5)
    await shot('item-trace')
    await click('Freigabe öffnen')
    expect(document.querySelectorAll('.gate-row')).toHaveLength(3)
    await shot('approval')
    await click('Zurück zum Graphen'); await click('Netzwerke & Workflows'); await click('Netzwerk erstellen')
    await shot('create')
    await click('Zurück'); applyLanguage('en'); await frame()
    expect(wrapper!.get('.graph-overview h1').text()).toBe('Networks & workflows')
    await shot('overview-en')
  })
  it('keeps graph, trace and approval inside a phone and readable in the dark', async () => {
    await page.viewport(390, 844); document.documentElement.style.colorScheme = 'dark'
    await open()
    await shot('phone-overview')
    await click('Workflows')
    expect(wrapper!.text()).toContain('Keine Ergebnisse für diesen Filter.')
    await click('Workflow erstellen')
    await shot('phone-workflow-create')
    await click('Abbrechen'); await click('Alle anzeigen')
    await click('E-Mail-Management')
    await wrapper!.findAll('.graph-node').find(node => node.text().includes('Archivieren'))!.trigger('click'); await frame()
    await shot('phone-blueprint')
    await click('Nur heute: 20 % auf alles')
    for (const row of rectangles('.item-trace li')) expect(row.right).toBeLessThanOrEqual(390)
    await shot('phone-item-trace')
    await click('Freigabe öffnen')
    for (const row of rectangles('.gate-row')) expect(row.right).toBeLessThanOrEqual(390)
    await shot('phone-approval')
  })
})

describe('graph in the browser workspace', () => {
  it('shows the published graph, its counts and one item trace read-only, without a worker', async () => {
    await page.viewport(1280, 900); applyLanguage('de')
    const fixture = await browserFixture()
    fixture.host.workspace.pods = pods.map(pod => ({ ...pod, online: true }))
    fixture.host.workspace.organization = { revision: 1, groups: [{ id: group, name: 'Delta Mind', collapsed: false, podIds: pods.map(pod => pod.id) }] }
    fixture.host.workflows = { ...view, graphs: { [graphId]: { ...detail, traces: { 'mail-0': trace.events } } } }
    Reflect.deleteProperty(window, 'pods')
    wrapper = mount(BrowserWorkspace, { props: { client: fixture.client }, attachTo: document.body }); await flushPromises(); await frame()
    const click = async (text: string) => { await (wrapper!.findAll('button').find(button => button.isVisible() && button.text() === text) ?? wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text)))!.trigger('click'); await flushPromises(); await frame() }
    expect(wrapper.findAll('button').map(button => button.text())).not.toContain('Netzwerk erstellen')
    expect(wrapper.findAll('h1').filter(heading => heading.isVisible()).map(heading => heading.text())).toEqual(['Netzwerke & Workflows'])
    await page.screenshot({ path: screenshotPath('graphs-browser-overview.png') })
    await click('Netzwerke')
    expect(wrapper.get('.graph-modes button[aria-pressed="true"]').text()).toBe('Netzwerke')
    await click('E-Mail-Management'); await click('Letzte Ausführung')
    expect(rectangles('.graph-node')).toHaveLength(10)
    expect(rectangles('.graph-count')).toHaveLength(6)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: screenshotPath('graphs-browser-last-run.png') })
    await click('Nur heute: 20 % auf alles')
    expect(document.querySelectorAll('.item-trace li')).toHaveLength(5)
    await click('Freigabe öffnen')
    expect(document.querySelector<HTMLAnchorElement>('.gate-review a')!.href).toBe(batch.url)
    expect(document.querySelectorAll('.gate-review input')).toHaveLength(0)
    await page.screenshot({ path: screenshotPath('graphs-browser-approval.png') })
  })
})

describe.each(['local', 'connected'] as const)('persistent network operations in the %s desktop', (surface) => {
  it('keeps structure, processing acknowledgements and recorded activity usable on a narrow screen', async () => {
    const fixture = operationalFixture()
    installWorkspace({
      language: async () => 'de',
      central: async command => command.type === 'status' ? { enabled: true, state: 'online', runtimeId: fixture.id(99) } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } },
      workspace: async () => ({ organization: fixture.organization, pods: fixture.pods }),
      definitions: async () => fixture.definitions,
      networks: async () => structuredClone(fixture.view),
    })
    await page.viewport(1280, 900); applyLanguage('de')
    wrapper = mount(surface === 'connected' ? DesktopWorkspace : App, { attachTo: document.body })
    await flushPromises(); await frame()
    const click = async (text: string) => {
      const button = wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))
      expect(button, text).toBeDefined(); await button!.trigger('click'); await flushPromises(); await frame()
    }
    const shot = async (name: string) => {
      expect(document.documentElement.scrollWidth, name).toBeLessThanOrEqual(innerWidth)
      await page.screenshot({ path: screenshotPath(`networks-${surface}-${name}.png`) })
    }
    await click(fixture.definition.name)
    expect(wrapper.findAll('.graph-node')).toHaveLength(3)
    await shot('structure-de')
    await page.viewport(390, 844); await frame()
    await wrapper.findAll('.graph-node')[0]!.trigger('click'); await frame()
    expect(wrapper.text()).toContain('Synthetic mailbox')
    wrapper.get('.network-member-detail').element.scrollIntoView(); await frame()
    await shot('phone-member-de')
    await click('Jetzt verarbeiten')
    const selection = wrapper.get('.network-process input[type=checkbox]')
    await selection.setValue(true); await frame()
    expect(wrapper.get('.network-process button').attributes('disabled')).toBeDefined()
    wrapper.get('.network-process').element.scrollIntoView(); await frame()
    await shot('phone-paused-consent-de')
    await click('Jetzt verarbeiten')
    applyLanguage('en'); await frame()
    await click('Recent recorded activity')
    expect(wrapper.text()).toContain('event-accepted')
    wrapper.get('.network-detail > section').element.scrollIntoView(); await frame()
    await shot('phone-activity-en')
  })
})

describe('network recovery with production desktop layout', () => {
  it('shows uncertain effects, pending exclusions and unknown approvals on desktop and phone', async () => {
    const f = recoveryFixture(); applyLanguage('en'); await page.viewport(1280, 1000)
    installWorkspace({ language: async () => 'en', workspace: async () => ({ organization: f.organization, pods: f.pods }), networks: async () => structuredClone(f.view), definitions: async () => f.definitions })
    wrapper = mount(App, { attachTo: document.body }); await flushPromises(); await frame()
    const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))!.trigger('click'); await flushPromises(); await frame() }
    await click(f.definition.name); await click('Failures requiring review: 1')
    expect(wrapper.text()).toContain('First inspect the stopped process.')
    const shot = async (name: string) => { expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth); await page.screenshot({ path: screenshotPath(`networks-recovery-${name}.png`) }) }
    wrapper.get('.network-detail article').element.scrollIntoView(); await frame(); await shot('desktop-effect')
    await page.viewport(390, 1000); await frame()
    wrapper.get('.network-detail article').element.scrollIntoView(); await frame(); await shot('phone-effect')
    for (const [index, name] of [[1, 'pending'], [2, 'unknown']] as const) {
      wrapper.findAll('.network-detail article')[index]!.element.scrollIntoView(); await frame(); await shot(`phone-${name}`)
      for (const box of rectangles('.network-detail textarea')) expect(box.right).toBeLessThanOrEqual(390)
    }
  })
})

it.each([1280, 390])('shows read-only persistent network data in the actual browser layout at %s pixels', async (width) => {
  const f = await browserFixture(); const network = recoveryFixture()
  network.view.networks[0]!.decisions = 2
  network.view.details!.collections = [{ id: network.id(70), name: 'Reviewed cases', version: 1 }]
  network.view.records = { collectionId: network.id(70), records: [{ key: 'case-one', revision: 1, schemaVersion: 1, body: '{"status":"reviewed"}', truncated: false, deleted: false, at: 1 }], after: null }
  f.host.networks = { networks: network.view.networks }
  f.host.workspace.pods = network.pods.map(pod => ({ ...pod, online: true }))
  f.host.workspace.organization = network.organization
  f.client.network = async () => structuredClone(network.view)
  Reflect.deleteProperty(window, 'pods')
  await page.viewport(width, 950)
  wrapper = mount(BrowserWorkspace, { attachTo: document.body, props: { client: f.client } }); await flushPromises(); await frame()
  await wrapper.findAll('button').find(button => button.text().includes(network.definition.name))!.trigger('click'); await flushPromises(); await frame()
  expect(wrapper.text()).toContain('Independent timer')
  expect(wrapper.findAll('button').map(button => button.text())).not.toContain('Process now')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshotPath(`networks-browser-structure-${width}.png`) })
  await wrapper.findAll('button').find(button => button.text() === 'Recent recorded activity')!.trigger('click'); await flushPromises(); await frame()
  expect(wrapper.text()).toContain('Item accepted')
  await page.screenshot({ path: screenshotPath(`networks-browser-activity-${width}.png`) })
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises(); await frame() }
  await click('Decisions and failures')
  expect(wrapper.text()).toContain('Synthetic pending invoice')
  await page.screenshot({ path: screenshotPath(`networks-browser-decisions-${width}.png`) })
  await click('Shared data'); await click('Reviewed cases · 1')
  expect(wrapper.get('.network-collection').attributes('aria-pressed')).toBe('true')
  expect(wrapper.text()).toContain('case-one')
  await page.screenshot({ path: screenshotPath(`networks-browser-data-${width}.png`) })
  if (width === 390) {
    document.documentElement.style.colorScheme = 'dark'; await frame()
    await page.screenshot({ path: screenshotPath('networks-browser-data-dark-390.png') })
    document.documentElement.style.colorScheme = ''; await frame()
  }
  f.host.online = false; f.wake(); await flushPromises()
  await click('Reviewed cases · 1')
  expect(wrapper.text()).toContain('Desktop offline: network details require the connected runtime')
  await page.screenshot({ path: screenshotPath(`networks-browser-offline-${width}.png`) })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
})

it.each([[1280, 'en'], [390, 'de']] as const)('shows conversion refusal and confirmation in the desktop route at %s pixels (%s)', async (width, language) => {
  const f = conversionFixture(); applyLanguage(language); await page.viewport(width, 1000)
  const workflows: WorkflowView = { workflows: [f.legacy], runs: [] }
  installWorkspace({ language: async () => language, workspace: async () => ({ organization: f.organization, pods: f.pods }), workflows: async () => workflows, definitions: async () => f.definitions, networks: async (command) => {
    if (command.type === 'setup') return { networks: [], setup: f.setup }
    if (command.type === 'conversionPreview') return { networks: [], conversion: { ...f.conversion, issues: command.selection.checkpoints.length !== 3 ? ['Review each exact checkpoint before conversion'] : command.selection.pending === 'block' ? ['Review retaining pending deliveries in the disabled legacy graph without replay'] : [] } }
    return { networks: [] }
  } })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises(); await frame()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))!.trigger('click'); await flushPromises(); await frame() }
  await click(f.legacy.name); await click(t('Review graph conversion')); await click(t('Review values and rights'))
  await click(t('Add field')); await wrapper.get('input[pattern]').setValue('subject')
  await wrapper.findAll('select').find(select => select.text().includes(t('Choose a type')))!.setValue('string')
  await wrapper.findAll('label').find(label => label.text().includes(t('I reviewed each channel schema against the existing scripts and payloads.')))!.get('input').setValue(true)
  await click(t('Preview conversion'))
  expect(wrapper.get('.network-conversion').text()).toContain('owner-reviewed-synthetic-baseline')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  wrapper.get('.network-conversion').element.scrollIntoView(); await frame()
  await page.screenshot({ path: screenshotPath(`network-conversion-review-${width}-${language}.png`) })
  for (const input of wrapper.findAll('.network-conversion .conversion-member input[type=checkbox]')) await input.setValue(true)
  await click(t('Validate reviewed conversion'))
  expect(wrapper.findAll('button').map(button => button.text())).not.toContain(t('Convert to paused network'))
  await wrapper.findAll('label').find(label => label.text().includes(t('Keep pending items in the disabled legacy graph without importing or replaying them.')))!.get('input').setValue(true)
  await click(t('Validate reviewed conversion'))
  const action = wrapper.findAll('button').find(button => button.text() === t('Convert to paused network'))!
  expect(action.attributes('disabled')).toBeDefined()
  action.element.scrollIntoView(); await frame()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshotPath(`network-conversion-confirm-${width}-${language}.png`) })
})

it.each([[1280, 'en'], [390, 'de']] as const)('shows archive review and retained history in the actual desktop route at %s (%s)', async (width, language) => {
  const f = operationalFixture(); applyLanguage(language); await page.viewport(width, 1000)
  if (width === 390) document.documentElement.style.colorScheme = 'dark'
  installWorkspace({ language: async () => language, workspace: async () => ({ organization: f.organization, pods: f.pods }), networks: async (command) => {
    if (command.type === 'archivePreview') return { ...f.view, archiveReview: { fingerprint: 'e'.repeat(64), issues: [], members: 3, retainedDeliveries: 1 } }
    if (command.type === 'legacyItems') return { ...f.view, legacyItems: { workflowId: f.id(80), items: [{ itemId: f.id(81), podId: f.pods[2]!.id, key: 'Synthetic retained case', payload: '{"subject":"Retained synthetic payload; no replay"}', truncated: false, originalHash: 'a'.repeat(64), currentHash: 'a'.repeat(64), state: 'pending' }], after: null } }
    return f.view
  } })
  wrapper = mount(App, { attachTo: document.body }); await flushPromises(); await frame()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))!.trigger('click'); await flushPromises(); await frame() }
  await click(f.definition.name); await click(t('Review archival'))
  expect(wrapper.findAll('button').find(button => button.text() === t('Archive network'))!.attributes('disabled')).toBeDefined()
  wrapper.get('.network-retirement').element.scrollIntoView(); await frame()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshotPath(`network-archive-review-${width}-${language}.png`) })
  await click(t('Inspect retained legacy items'))
  wrapper.get('.legacy-items').element.scrollIntoView(); await frame()
  expect(wrapper.get('.legacy-items').text()).toContain('Retained synthetic payload; no replay')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  await page.screenshot({ path: screenshotPath(`network-retained-items-${width}-${language}.png`) })
})
