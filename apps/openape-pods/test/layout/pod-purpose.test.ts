import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { centralFixture } from '../workspace/central-fixture'
import { installWorkspace, podId } from './workspace-fixture'

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
