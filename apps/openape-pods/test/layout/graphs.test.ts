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
import { applyLanguage } from '../../src/renderer/i18n'
import { screenshotPath } from './evidence'
import { installWorkspace } from './workspace-fixture'
import { operationalFixture } from './network-fixture'

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
