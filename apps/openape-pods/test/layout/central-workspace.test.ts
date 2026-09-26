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

it.each(['en', 'de'] as const)('shows Jev in the active desktop settings with readable navigation (%s)', async (language) => {
  const { default: DesktopWorkspace } = await import('../../src/renderer/central/DesktopWorkspace.vue')
  const { installWorkspace } = await import('./workspace-fixture')
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
  const sidebar = wrapper.get('.central-sidebar').element.getBoundingClientRect()
  const account = wrapper.get('.account-status').element.getBoundingClientRect()
  const settings = wrapper.get('.central-settings-button').element.getBoundingClientRect()
  expect(account.bottom).toBeLessThanOrEqual(settings.top)
  expect(settings.right).toBeLessThanOrEqual(sidebar.right)
  expect(settings.bottom).toBeLessThanOrEqual(innerHeight)
  const list = wrapper.get('.central-pod-list').element
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
  expect(list.getBoundingClientRect().bottom).toBeLessThan(account.top)
  expect(wrapper.get('.account-status').text()).toContain('owner@example.invalid')
  expect(wrapper.find('.central-header button').exists()).toBe(false)
  await page.screenshot({ path: `../../.artifacts/jev-desktop-sidebar-${language}.png` })
  await wrapper.get('.central-sidebar-bottom .central-settings-button').trigger('click')
  await flushPromises()
  const input = wrapper.get('input[type="password"]').element.getBoundingClientRect()
  expect(input.width).toBeGreaterThan(200)
  expect(input.top).toBeGreaterThan(0)
  expect(input.bottom).toBeLessThan(innerHeight)
  expect(wrapper.get('.settings-navigation').element.getBoundingClientRect().bottom).toBeLessThan(input.top)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: `../../.artifacts/jev-desktop-settings-${language}.png` })
})
