import { screenshotPath } from './evidence'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import BrowserWorkspace from '../../src/renderer/central/BrowserWorkspace.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import { installWorkspace } from './workspace-fixture'
import { browserFixture } from '../workspace/browser-fixture'
import { applyLanguage, t } from '../../src/renderer/i18n'
import { centralFixture } from '../workspace/central-fixture'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
async function openInventory(fixture: Awaited<ReturnType<typeof browserFixture>>) {
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { attachTo: document.body, props: { client: fixture.client } })
  await flushPromises()
  await wrapper.get(`.workspace-navigation [aria-label="${t('Pods')}"]`).trigger('click')
  await flushPromises()
  expect(wrapper.get('.workspace-brand svg').isVisible()).toBe(true)
  return wrapper
}
it('renders the same workspace at desktop and narrow browser sizes without overflow', async () => {
  wrapper = await openInventory(await browserFixture())
  await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  for (const width of [1280, 560]) {
    await page.viewport(width, 950)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(wrapper.find('.remote-editor .tabs').element.getBoundingClientRect().width).toBeGreaterThan(350)
    await page.screenshot({ path: screenshotPath(`central-workspace-${width}.png`) })
  }
  applyLanguage('de'); document.documentElement.style.colorScheme = 'dark'
  await flushPromises(); await page.viewport(560, 950)
  await page.screenshot({ path: screenshotPath('central-workspace-de-dark.png') })
  await wrapper.get('#pod-description').setValue('Unsaved remote description')
  await wrapper.get('.central-content > .text-button').trigger('click'); await flushPromises()
  const prompt = wrapper.get('[aria-label="Ungespeicherte Änderungen"]')
  expect(prompt.text()).toContain('Weiter bearbeiten')
  expect(prompt.element.getBoundingClientRect().right).toBeLessThanOrEqual(560)
  await page.screenshot({ path: screenshotPath('central-unsaved-edits.png') })
})

it('keeps Script and Permissions free of Jev setup in the narrow central workspace', async () => {
  const fixture = await browserFixture()
  fixture.view.resources.jev = { id: fixture.view.id, state: 'ready', verifiedAt: 1 }
  fixture.view.resources.resources.push({ id: fixture.view.id, podId: fixture.view.id, kind: 'tool', state: 'ready', name: 'TypeSafe / Jev', revision: 1, configuration: { type: 'jev', model: 'jev-1.13.0', maxAttempts: 20 } })
  wrapper = await openInventory(fixture)
  await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  await page.viewport(390, 950)
  for (const tab of ['Script', 'Permissions']) {
    await wrapper.findAll('.remote-editor .tabs button').find(item => item.text() === tab)!.trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain('Jev script reference')
    expect(wrapper.text()).not.toContain('TypeSafe connection')
    expect(wrapper.text()).not.toContain('TypeSafe / Jev')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({ path: screenshotPath(`jev-central-${tab.toLowerCase()}.png`) })
  }
})

it.each(['en', 'de'] as const)('shows Jev in the active desktop settings with readable navigation (%s)', async (language) => {
  const { host } = centralFixture()
  host.workspace.pods = Array.from({ length: 30 }, (_, index) => ({ ...host.workspace.pods[0]!, id: `pod-${index}`, name: `Release monitor ${index + 1}` }))
  installWorkspace({ onboarding: async () => ({ owner: 'owner', complete: true, runtime: { ready: true, error: null }, connections: [{ id: 'owner', provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null }] }), central: async (command) => {
    if (command.type === 'status') return { enabled: false }
    if (command.type === 'inventory') return [host]
    return { requestError: { status: 400, message: 'No fixture change feed' } }
  } })
  applyLanguage(language)
  await page.viewport(language === 'de' ? 560 : 1060, 950)
  document.documentElement.style.colorScheme = language === 'de' ? 'dark' : 'light'
  wrapper = mount(DesktopWorkspace, { attachTo: document.body }); await flushPromises()
  const navigation = wrapper.get('.workspace-navigation').element.getBoundingClientRect()
  const settings = wrapper.findAll('.workspace-navigation nav button')[2]!
  expect(settings.element.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth)
  expect(settings.element.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight)
  expect(navigation.width).toBeGreaterThan(100)
  expect(wrapper.get('.account-status').text()).toContain('owner@example.invalid')
  await page.screenshot({ path: screenshotPath(`jev-desktop-sidebar-${language}.png`) })
  await settings.trigger('click')
  await flushPromises()
  await wrapper.get('.jev-account-row button').trigger('click'); await flushPromises()
  const input = wrapper.get('input[type="password"]').element.getBoundingClientRect()
  expect(input.width).toBeGreaterThan(200)
  expect(input.top).toBeGreaterThan(0)
  expect(input.bottom).toBeLessThan(innerHeight)
  expect(wrapper.get('.app-settings h1').element.getBoundingClientRect().top).toBeLessThan(input.top)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: screenshotPath(`jev-desktop-settings-${language}.png`) })
})

it.each(['en', 'de'] as const)('keeps the deletion review readable in the central workspace (%s)', async (language) => {
  const fixture = await browserFixture()
  fixture.view.scripts.pod.lifecycle = 'archived'
  fixture.host.workspace.pods[0]!.lifecycle = 'archived'
  applyLanguage(language)
  document.documentElement.style.colorScheme = language === 'de' ? 'dark' : 'light'
  const width = language === 'de' ? 390 : 1280
  await page.viewport(width, 950)
  wrapper = await openInventory(fixture)
  await flushPromises(); await wrapper.findAll('.inventory-toolbar button')[1]!.trigger('click'); await flushPromises(); await wrapper.find('.central-pod').trigger('click'); await flushPromises()
  await wrapper.findAll('.remote-editor .tabs button').find(button => button.text() === (language === 'de' ? 'Einstellungen' : 'Settings'))!.trigger('click')
  await flushPromises()
  await wrapper.get('.pod-lifecycle button').trigger('click'); await flushPromises()
  const review = wrapper.get('[role="alertdialog"]')
  review.element.scrollIntoView({ block: 'center' })
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
  expect(review.text()).toContain('Mail knowledge')
  expect(review.element.getBoundingClientRect().width).toBeGreaterThan(250)
  await page.screenshot({ path: screenshotPath(`pod-deletion-${language}.png`) })
})
