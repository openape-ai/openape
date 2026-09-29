import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import BrowserWorkspace from '../../src/renderer/central/BrowserWorkspace.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import { applyLanguage, t } from '../../src/renderer/i18n'
import { browserFixture } from '../workspace/browser-fixture'
import { screenshotPath } from './evidence'

let wrapper: VueWrapper | undefined
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); document.documentElement.style.colorScheme = '' })
async function click(text: string) { await wrapper!.findAll('button').find(item => item.isVisible() && item.text() === text)!.trigger('click'); await flushPromises(); await frame() }
async function navigate(label: string) { await wrapper!.get(`.workspace-navigation [aria-label="${label}"]`).trigger('click'); await flushPromises(); await frame() }
function metric(selector: string) {
  const element = wrapper!.get(selector).element
  const rect = element.getBoundingClientRect(); const style = getComputedStyle(element)
  return { x: rect.x, width: rect.width, font: style.fontSize, color: style.color, background: style.backgroundColor, radius: style.borderRadius }
}
async function capture(name: string) {
  await frame()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  expect(wrapper!.findAll('[role="alert"]').filter(item => item.isVisible()).map(item => item.text())).toEqual([])
  await page.screenshot({ path: screenshotPath(name) })
}

it.each([{ width: 1280, language: 'en', theme: 'light' }, { width: 390, language: 'de', theme: 'dark' }] as const)('matches desktop geometry and shares every Pod view at $width pixels in $theme mode', async ({ width, language, theme }) => {
  await page.viewport(width, 1000); applyLanguage(language); document.documentElement.style.colorScheme = theme
  const metrics = new Map<string, ReturnType<typeof metric>>()
  for (const surface of ['desktop', 'browser']) {
    const fixture = await browserFixture()
    if (surface === 'browser') Reflect.deleteProperty(window, 'pods')
    wrapper = surface === 'browser' ? mount(BrowserWorkspace, { props: { client: fixture.client }, attachTo: document.body }) : mount(DesktopWorkspace, { attachTo: document.body })
    await flushPromises(); await frame()
    await capture(`parity-${surface}-${width}-workflows.png`)
    await navigate(t('Pods'))
    await capture(`parity-${surface}-${width}-pods.png`)
    await click(t('Archived')); await capture(`parity-${surface}-${width}-archive.png`); await click(t('Current Pods'))
    await wrapper.get('.central-pod').trigger('click'); await flushPromises(); await frame()
    for (const tab of ['Overview', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History'] as const) {
      await click(t(tab))
      const selector = tab === 'Script' ? '.script-panel' : tab === 'Variables and secrets' ? '#pod-values .card' : tab === 'Permissions' ? '.resource-panel' : tab === 'Settings' ? '.pod-settings' : tab === 'History' ? '.runs-panel' : '#pod-description'
      const key = tab
      if (surface === 'desktop') metrics.set(key, metric(selector))
      else expect(metric(selector)).toEqual(metrics.get(key))
      await capture(`parity-${surface}-${width}-${tab.toLowerCase().replaceAll(' ', '-')}.png`)
    }
    await navigate(t('App settings')); await capture(`parity-${surface}-${width}-app-settings.png`)
    wrapper.unmount(); wrapper = undefined
  }
})

it.each([390, 1280])('shows grouped Pods and filters workflow members in both full workspaces at %s px', async (width) => {
  await page.viewport(width, 1000)
  applyLanguage('de'); document.documentElement.style.colorScheme = width === 390 ? 'dark' : 'light'
  for (const surface of ['desktop', 'browser']) {
    const fixture = await browserFixture()
    const pod = fixture.host.workspace.pods[0]!
    fixture.host.workspace.pods.push({ ...pod, id: 'standalone', name: 'Standalone review' }, { ...pod, id: 'monthly', name: 'Monthly report' })
    fixture.host.workspace.organization.groups = [{ id: 'operations', name: 'Operations', collapsed: false, podIds: [pod.id, 'standalone'] }]
    fixture.bridge.workspace = async () => structuredClone(fixture.host.workspace)
    if (surface === 'browser') Reflect.deleteProperty(window, 'pods')
    wrapper = surface === 'browser' ? mount(BrowserWorkspace, { props: { client: fixture.client }, attachTo: document.body }) : mount(DesktopWorkspace, { attachTo: document.body })
    await flushPromises(); await frame(); await navigate(t('Pods'))
    expect(wrapper.get('.workspace-logo svg').isVisible()).toBe(true)
    expect(wrapper.find('.central-header').exists()).toBe(false)
    const checkbox = wrapper.get('.workflow-pods-filter input')
    const filter = wrapper.get('.workflow-pods-filter')
    expect(filter.text()).toBe('Pods in Workflows anzeigen')
    expect(checkbox.element.getBoundingClientRect().width).toBeGreaterThan(10)
    expect(filter.element.getBoundingClientRect().right).toBeLessThanOrEqual(width)
    expect(wrapper.findAll('.inventory-group h2').map(heading => heading.text())).toEqual(['Operations 2', 'Nicht gruppiert 1'])
    await capture(`pod-groups-${surface}-${width}.png`)
    await checkbox.setValue(false)
    expect(wrapper.findAll('.central-pod strong').map(name => name.text())).toEqual(['Standalone review', 'Monthly report'])
    expect(wrapper.findAll('.inventory-group h2').map(heading => heading.text())).toEqual(['Operations 1', 'Nicht gruppiert 1'])
    await capture(`pod-groups-filtered-${surface}-${width}.png`)
    await navigate(t('Workflows')); await navigate(t('Pods'))
    expect((wrapper.get('.workflow-pods-filter input').element as HTMLInputElement).checked).toBe(false)
    wrapper.unmount(); wrapper = undefined
  }
})
