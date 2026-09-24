import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import CentralWorkspace from '../../src/renderer/central/CentralWorkspace.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { centralFixture } from '../workspace/central-fixture'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
it('renders the same workspace at desktop and narrow browser sizes without overflow', async () => {
  wrapper = mount(CentralWorkspace, { attachTo: document.body, props: { client: centralFixture().client } })
  await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  for (const width of [1280, 560]) {
    await page.viewport(width, 950)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(wrapper.find('.central-tabs').element.getBoundingClientRect().width).toBeGreaterThan(350)
    await page.screenshot({ path: `../../.artifacts/central-workspace-${width}.png` })
  }
  applyLanguage('de'); document.documentElement.style.colorScheme = 'dark'
  await flushPromises(); await page.viewport(560, 950)
  await page.screenshot({ path: '../../.artifacts/central-workspace-de-dark.png' })
})
