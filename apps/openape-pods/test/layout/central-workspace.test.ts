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

it('keeps Script and Permissions free of Jev setup in the narrow central workspace', async () => {
  const fixture = centralFixture()
  fixture.view.resources.jev = { id: fixture.view.id, state: 'ready', verifiedAt: 1 }
  fixture.view.resources.resources.push({ id: fixture.view.id, podId: fixture.view.id, kind: 'tool', state: 'ready', name: 'TypeSafe / Jev', revision: 1, configuration: { type: 'jev', model: 'jev-1.13.0', maxAttempts: 20 } })
  wrapper = mount(CentralWorkspace, { attachTo: document.body, props: { client: fixture.client } })
  await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  await page.viewport(390, 950)
  for (const tab of ['Script', 'Permissions']) {
    await wrapper.findAll('.central-tabs button').find(item => item.text() === tab)!.trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('Jev script reference')
    expect(wrapper.text()).not.toContain('TypeSafe connection')
    expect(wrapper.text()).not.toContain('TypeSafe / Jev')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({ path: `../../.artifacts/jev-central-${tab.toLowerCase()}.png` })
  }
})
