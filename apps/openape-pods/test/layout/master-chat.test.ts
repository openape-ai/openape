import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { installWorkspace } from './workspace-fixture'

// Issue 1377 replaces embedded chat surfaces with direct management forms.
let wrapper: VueWrapper | undefined
const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
it.each(['en', 'de'] as const)('keeps direct description and creation forms usable without conversation UI (%s)', async (language) => {
  applyLanguage(language); installWorkspace()
  wrapper = mount(App, { attachTo: document.body }); await flushPromises()
  expect(wrapper.find('.master-compose').exists()).toBe(false)
  expect(wrapper.findAll('[role="tab"]').map(tab => tab.text())).not.toContain('Chat')
  for (const width of [1060, 760, 560]) {
    await page.viewport(width, 700); await frame()
    const description = wrapper.get('#pod-description').element.getBoundingClientRect()
    expect(description.width).toBeGreaterThan(100)
    expect(description.right).toBeLessThanOrEqual(innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: `../../.artifacts/codex-management-${language}-${width}.png` })
  }
  await wrapper.get('.new-pod').trigger('click'); await flushPromises(); await frame()
  expect(wrapper.find('input').exists()).toBe(true)
  expect(wrapper.find('.master-compose').exists()).toBe(false)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
})
