import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { installWorkspace } from './workspace-fixture'

const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
it.each(['en', 'de'] as const)('keeps the execution preference readable and operable in desktop settings (%s)', async (language) => {
  installWorkspace({ runtimeApproval: async command => ({ enabled: command.type === 'set' ? command.enabled : false }) })
  applyLanguage(language)
  const view = mount(App, { attachTo: document.body })
  try {
    await page.viewport(language === 'de' ? 560 : 1060, 850)
    document.documentElement.style.colorScheme = language === 'de' ? 'dark' : 'light'
    await flushPromises()
    await view.get('.nav-button[aria-label]').trigger('click'); await flushPromises()
    const checkbox = view.get<HTMLInputElement>('.runtime-approval-option input')
    await checkbox.setValue(true); await flushPromises()
    view.get('.runtime-approval-settings').element.scrollIntoView({ block: 'center' }); await frame()
    expect(checkbox.element.checked).toBe(true)
    const label = view.get('.runtime-approval-option').element.getBoundingClientRect()
    expect(label.width).toBeGreaterThan(100)
    expect(label.right).toBeLessThanOrEqual(innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: `../../.artifacts/runtime-approval-${language}.png` })
  }
  finally { view.unmount(); applyLanguage('en'); document.documentElement.style.colorScheme = '' }
})
