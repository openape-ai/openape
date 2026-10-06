import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import GraphOverview from '../../src/renderer/GraphOverview.vue'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { centralFixture } from '../workspace/central-fixture'
import { operationalFixture } from './network-fixture'
import { installWorkspace, podId, pods } from './workspace-fixture'

// Geometry of the lines that tell what a Pod does: the purpose in inventory rows
// and overview cards, the last result on the Pod overview and readable choice
// fields. Their text and behaviour are covered in test/workspace and test/scheduling.
const purpose = 'Watches the product management task board and reports every changed task by Telegram, including the previous and the new state.'
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const box = (wrapper: VueWrapper, selector: string) => wrapper.get(selector).element.getBoundingClientRect()
const fits = () => expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })

it('puts the purpose under the Pod name in the central inventory at desktop and phone width', async () => {
  const fixture = centralFixture()
  fixture.host.workspace.pods[0]!.description = purpose
  wrapper = mount(CentralWorkspace, { attachTo: document.body, props: { client: fixture.client } }); await flushPromises()
  for (const width of [1280, 390]) {
    await page.viewport(width, 700); await frame()
    fits()
    expect(box(wrapper, '.inventory-purpose').top).toBeGreaterThanOrEqual(box(wrapper, '.central-pod strong').bottom)
    expect(box(wrapper, '.inventory-purpose').right).toBeLessThanOrEqual(box(wrapper, '.central-pod').right)
    expect(Number.parseFloat(getComputedStyle(wrapper.get('.inventory-purpose').element).fontSize)).toBe(13)
    await page.screenshot({ path: screenshotPath(`purpose-inventory-${width}.png`) })
  }
})

it('keeps a described standalone Pod card inside the overview grid in a narrow dark German window', async () => {
  applyLanguage('de'); document.documentElement.style.colorScheme = 'dark'
  const described = pods.map(pod => pod.id === podId ? { ...pod, description: purpose } : pod)
  wrapper = mount(GraphOverview, { attachTo: document.body, props: { view: { workflows: [], runs: [] }, pods: described, organization: { revision: 1, groups: [] } } })
  await page.viewport(390, 700); await frame()
  fits()
  expect(box(wrapper, '.graph-card').right).toBeLessThanOrEqual(390)
  expect(wrapper.get('.graph-card').text()).toContain(purpose)
  await page.screenshot({ path: screenshotPath('purpose-overview-card-de-dark.png') })
})

it('shows the last result under the headline on the Pod overview', async () => {
  installWorkspace()
  wrapper = mount(App, { attachTo: document.body, props: { initialPodId: podId } }); await flushPromises()
  await page.viewport(1060, 850); await frame()
  fits()
  const result = wrapper.findAll('#panel-Overview p').find(item => item.text() === 'Local example completed (1)')!
  const headline = wrapper.findAll('#panel-Overview p').find(item => item.text() === 'Run completed')!
  expect(result.element.getBoundingClientRect().top).toBeGreaterThanOrEqual(headline.element.getBoundingClientRect().bottom)
  expect(wrapper.get('label[for="pod-description"]').text()).toBe('What this Pod does')
  await page.screenshot({ path: screenshotPath('purpose-pod-overview.png') })
})

it('lays out choice fields as label and value and keeps a long value inside a phone', async () => {
  const f = operationalFixture()
  const payload = JSON.stringify({ account: 'owner@example.com', category: 'newsletter', confidence: 0.78, date: '2026-10-05T10:50:29Z', evidence: 'a'.repeat(64), sender: 'a-very-long-sender-address-without-any-break@newsletter-distribution.example.com', subject: 'October product news and the complete release overview' })
  f.view.choices = [{ networkId: f.networkId, revision: 1, eventId: f.id(70), caseId: f.id(71), gate: 'review', title: 'Review uncertain mail', payload, truncated: false, options: [{ key: 'keep', title: 'Keep for review' }, { key: 'news', title: 'Newsletter candidate' }] }]
  installWorkspace({ language: async () => 'en', workspace: async () => ({ organization: f.organization, pods: f.pods }), networks: async () => structuredClone(f.view), definitions: async () => f.definitions })
  await page.viewport(1060, 850)
  wrapper = mount(App, { attachTo: document.body }); await flushPromises(); await frame()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))!.trigger('click'); await flushPromises(); await frame() }
  await click(f.definition.name); await click('Decisions and failures')
  const card = () => wrapper!.findAll('.network-detail article').find(article => article.text().includes('Review uncertain mail'))!
  for (const width of [1060, 390]) {
    await page.viewport(width, 850); await frame()
    card().element.scrollIntoView(); await frame()
    fits()
    const label = card().get('dt').element.getBoundingClientRect(); const value = card().get('dd').element.getBoundingClientRect()
    expect(value.left).toBeGreaterThanOrEqual(label.right)
    expect(Math.abs(value.top - label.top)).toBeLessThan(4)
    for (const item of card().findAll('dd')) expect(item.element.getBoundingClientRect().right).toBeLessThanOrEqual(width)
    expect(card().get('details pre').element.checkVisibility()).toBe(false)
    await page.screenshot({ path: screenshotPath(`choice-card-${width}.png`) })
  }
})

it('shows what a network is for on its card and page and keeps the edit form inside a phone', async () => {
  const f = operationalFixture()
  const descriptions = [{ id: f.networkId, text: 'Sorts incoming mail into newsletters, invoices and replies, and asks the owner before anything is archived. Uncertain mail waits for a decision.', revision: 1 }]
  installWorkspace({ language: async () => 'en', workspace: async () => ({ organization: f.organization, pods: f.pods, descriptions }), networks: async () => structuredClone(f.view), definitions: async () => f.definitions })
  await page.viewport(1060, 850)
  wrapper = mount(App, { attachTo: document.body }); await flushPromises(); await frame()
  const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.isVisible() && button.text().includes(text))!.trigger('click'); await flushPromises(); await frame() }
  expect(wrapper.get('.graph-card').text()).toContain('Sorts incoming mail into newsletters, invoices and replies, and asks the owner before anything is archived.')
  fits()
  await page.screenshot({ path: screenshotPath('network-card-description.png') })
  await click(f.definition.name)
  const block = () => wrapper!.get('.collection-description').element.getBoundingClientRect()
  expect(block().top).toBeGreaterThanOrEqual(wrapper.get('.network-detail h1').element.getBoundingClientRect().bottom)
  expect(Math.abs(wrapper.get('.collection-description > .text-button').element.getBoundingClientRect().left - wrapper.get('.collection-description p').element.getBoundingClientRect().left)).toBeLessThan(2)
  fits()
  await page.screenshot({ path: screenshotPath('network-description-1060.png') })
  await click('Edit description')
  await page.viewport(390, 850); await frame()
  fits()
  expect(wrapper.get('.collection-description textarea').element.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  expect(wrapper.get('.collection-description textarea').element.getBoundingClientRect().width).toBeGreaterThan(250)
  await page.screenshot({ path: screenshotPath('network-description-edit-390.png') })
})
