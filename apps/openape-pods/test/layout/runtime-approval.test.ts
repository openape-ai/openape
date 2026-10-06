import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import App from '../../src/renderer/App.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { installWorkspace } from './workspace-fixture'

const frame = () => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))
it.each(['en', 'de'] as const)('keeps the execution preference readable and operable in desktop settings (%s)', async (language) => {
  const state = { enabled: false, standing: false, owner: 'owner@example.test', scope: 'a'.repeat(64) }
  installWorkspace({ runtimeApproval: async (command) => {
    if (command.type === 'set') state.enabled = command.enabled
    if (command.type === 'setStanding') state.standing = command.enabled
    return { ...state }
  } })
  applyLanguage(language)
  const view = mount(App, { attachTo: document.body })
  try {
    await page.viewport(language === 'de' ? 560 : 1060, 850)
    document.documentElement.style.colorScheme = language === 'de' ? 'dark' : 'light'
    await flushPromises()
    await view.findAll('.workspace-navigation nav button')[2]!.trigger('click'); await flushPromises()
    const standing = view.get<HTMLInputElement>('.standing-runtime-option input')
    await standing.setValue(true); await flushPromises()
    expect(standing.element.checked).toBe(true)
    const checkbox = view.get<HTMLInputElement>('.runtime-approval-option input')
    await checkbox.setValue(true); await flushPromises()
    view.get('.runtime-approval-settings').element.scrollIntoView({ block: 'center' }); await frame()
    expect(checkbox.element.checked).toBe(true)
    expect(standing.element.checked).toBe(true)
    const label = view.get('.runtime-approval-option').element.getBoundingClientRect()
    expect(label.width).toBeGreaterThan(100)
    expect(label.right).toBeLessThanOrEqual(innerWidth)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
    await page.screenshot({ path: screenshotPath(`runtime-approval-${language}.png`) })
  }
  finally { view.unmount(); applyLanguage('en'); document.documentElement.style.colorScheme = '' }
})
