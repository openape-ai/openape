import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import AutomationsShell from '../../src/renderer/central/AutomationsShell.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import fixture from '../renderer/map-view.json'
import { screenshotPath } from './evidence'

/**
 * M7 proof: the desktop and the browser render the same shell from the same map. The only
 * differences are the native controls the browser cannot offer, which it shows disabled with the
 * hint "Nur am Desktop", and the account row of the gear menu.
 */
const view = parseMapView(fixture) as MapView
const NOW = view.at + 11 * 60000
const frames = (count = 40) => new Promise<void>((done) => { const tick = (left: number) => left ? requestAnimationFrame(() => tick(left - 1)) : done(); tick(count) })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en') })
async function capture(desktop: boolean) {
  applyLanguage('de'); await page.viewport(1440, 1000); localStorage.setItem('pods.automations.mode', 'map')
  wrapper = mount(AutomationsShell, { attachTo: document.body, props: { view, live: true, now: NOW, desktop, sharing: true, ...(desktop ? {} : { subject: 'owner@example.invalid' }) } })
  await flushPromises(); await frames()
  const text = wrapper.text()
  const native = wrapper.findAll('button[title="Nur am Desktop"]').map(button => button.text().trim())
  const layout = ['.kpi-row', '.automations-toolbar', '[data-testid="automations-map"] canvas', '.automation-info'].map((selector) => { const box = document.querySelector(selector)!.getBoundingClientRect(); return [selector, Math.round(box.left), Math.round(box.top), Math.round(box.width)] })
  await page.screenshot({ path: screenshotPath(`redesign-parity-${desktop ? 'desktop' : 'browser'}.png`) })
  wrapper.unmount(); wrapper = undefined
  return { text, native, layout }
}

it('renders the same shell on the desktop and in the browser, differing only in native controls', async () => {
  const desktop = await capture(true)
  const browser = await capture(false)
  expect(desktop.native).toEqual([])
  // Native-only actions moved to the Pod page; the shell itself has none left.
  expect(browser.native).toEqual([])
  expect(browser.layout).toEqual(desktop.layout)
  expect(browser.text).toBe(desktop.text)
})
