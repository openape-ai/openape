import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import DemoApp from '../../src/renderer/demo/DemoApp.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { screenshotPath } from './evidence'

let wrapper: VueWrapper | undefined
const originalUrl = location.href
afterEach(() => { wrapper?.unmount(); wrapper = undefined; applyLanguage('en'); localStorage.clear(); history.replaceState(null, '', originalUrl); document.documentElement.style.colorScheme = ''; vi.restoreAllMocks() })
async function open(scenario = 'everyday', width = 1440) {
  const url = new URL(location.href); url.searchParams.set('scenario', scenario); history.replaceState(null, '', url)
  Reflect.deleteProperty(window, 'pods')
  await page.viewport(width, width === 390 ? 844 : 1000)
  wrapper = mount(DemoApp, { attachTo: document.body })
  await flushPromises()
  return wrapper
}
async function click(text: string) {
  const button = wrapper!.findAll('button').find(item => item.isVisible() && item.text().trim() === text)
  expect(button, `button ${text}`).toBeDefined()
  await button!.trigger('click'); await flushPromises()
}
async function shot(name: string) {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: screenshotPath(`ui-dev-${name}.png`) })
}

it('uses the actual Pod components for edits, pause, simulated runs and reset without native access', async () => {
  const requests = vi.spyOn(globalThis, 'fetch')
  await open()
  // Six everyday Pods plus three edge cases (failing, recovered, paused after failure); archived ones stay hidden.
  await expect.poll(() => wrapper!.findAll('[data-pod]').length).toBe(9)
  await shot('automations-wide')
  await wrapper!.get('[data-pod="00000000-0000-4000-8000-000000000001"]').trigger('click'); await flushPromises()
  expect(wrapper!.findAll('[role="alert"]').map(item => item.text())).toEqual([])
  await wrapper!.get('#pod-description').setValue('Geprüfte Rechnungen für Northwind vorbereiten.')
  await wrapper!.get('#pod-description').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
  await wrapper!.get('#pod-values .value-row button').trigger('click')
  await wrapper!.findAll('#pod-values form input')[1]!.setValue('reviewed-invoices')
  await wrapper!.get('#pod-values form').trigger('submit'); await flushPromises()
  await wrapper!.get('.schedule-panel form input[type="number"]').setValue(60)
  await wrapper!.get('.schedule-panel form').trigger('submit'); await flushPromises()
  await click('Pausieren')
  await expect.poll(() => wrapper!.findAll('button').some(item => item.text() === 'Fortsetzen')).toBe(true)
  await click('Jetzt ausführen')
  await expect.poll(() => wrapper!.text()).toContain('Demo abgeschlossen: 12 Einträge geprüft.')
  await shot('pod-details-wide')
  await wrapper!.get('[data-testid="back-to-automations"]').trigger('click'); await flushPromises()
  await expect.poll(() => wrapper!.get('[data-pod="00000000-0000-4000-8000-000000000001"]').text()).toContain('Geprüfte Rechnungen für Northwind vorbereiten.')
  await wrapper!.get('[data-pod="00000000-0000-4000-8000-000000000001"]').trigger('click'); await flushPromises()
  expect(wrapper!.get('#pod-values').text()).toContain('reviewed-invoices')
  expect((wrapper!.get('.schedule-panel form input[type="number"]').element as HTMLInputElement).value).toBe('60')
  await click('Zurücksetzen')
  await expect.poll(() => wrapper!.findAll('[data-pod]').length).toBe(9)
  expect(wrapper!.text()).not.toContain('Geprüfte Rechnungen für Northwind vorbereiten.')
  expect(window.pods).toBeUndefined()
  expect(requests).not.toHaveBeenCalled()
})

it('keeps a failed decision actionable, confirms grouped choices and resets all counters', async () => {
  await open('attention')
  await expect.poll(() => wrapper!.findAll('[data-pod]').length).toBe(6)
  await wrapper!.get('[role="tablist"] button:nth-child(2)').trigger('click'); await flushPromises()
  await wrapper!.get('[data-question="demo-question-1"] button').trigger('click'); await flushPromises()
  expect(wrapper!.get('[data-question="demo-question-1"]').text()).toContain('Speichern fehlgeschlagen')
  await shot('decision-error-wide')
  await wrapper!.get('[data-question="demo-question-1"] button').trigger('click'); await flushPromises()
  await expect.poll(() => wrapper!.findAll('[data-question]').length).toBe(3)
  const group = wrapper!.findAll('button').find(item => item.text() === 'alle: Archivieren')!
  await group.trigger('click'); await flushPromises()
  await expect.poll(() => wrapper!.findAll('[data-question]').length).toBe(1)
  await wrapper!.get('[data-question] button').trigger('click'); await flushPromises()
  await expect.poll(() => wrapper!.findAll('[data-question]').length).toBe(0)
  expect(wrapper!.text()).toContain('Nichts wartet auf deine Entscheidung.')
  await click('Zurücksetzen')
  await wrapper!.get('[role="tablist"] button:nth-child(2)').trigger('click'); await flushPromises()
  await expect.poll(() => wrapper!.findAll('[data-question]').length).toBe(4)
})

it('renders all three areas narrowly with real CSS and restores empty/error scenarios', async () => {
  await open('everyday', 390)
  document.documentElement.style.colorScheme = 'dark'
  // Six everyday Pods plus three edge cases (failing, recovered, paused after failure); archived ones stay hidden.
  await expect.poll(() => wrapper!.findAll('[data-pod]').length).toBe(9)
  await shot('automations-narrow')
  await wrapper!.get('[role="tablist"] button:nth-child(2)').trigger('click'); await flushPromises()
  await shot('decisions-narrow')
  await wrapper!.get('[role="tablist"] button').trigger('click'); await flushPromises()
  await wrapper!.get('[data-pod="00000000-0000-4000-8000-000000000001"]').trigger('click'); await flushPromises()
  await shot('pod-details-narrow')
  await wrapper!.get('.demo-toolbar select').setValue('empty'); await flushPromises()
  await expect.poll(() => wrapper!.findAll('[data-pod]').length).toBe(0)
  await shot('empty-narrow')
  await wrapper!.get('.demo-toolbar select').setValue('loading-error'); await flushPromises()
  await expect.poll(() => wrapper!.text()).toContain('Demo-Verbindung unterbrochen')
  await shot('read-error-narrow')
  await click('Demo-Verbindung wiederherstellen')
  await expect.poll(() => wrapper!.findAll('[data-pod]').length, { timeout: 3000 }).toBe(6)
  expect(wrapper!.findAll('[role="alert"]').map(item => item.text())).toEqual([])
  vi.restoreAllMocks()
})
