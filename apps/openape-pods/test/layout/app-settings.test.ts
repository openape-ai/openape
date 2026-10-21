import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import type { SecretsView } from '../../src/contracts/secrets'
import AppSettings from '../../src/renderer/AppSettings.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import fixture from '../renderer/map-view.json'
import { screenshotPath } from './evidence'
import { installWorkspace, pods } from './workspace-fixture'

// Issue 1468: one settings page for gear and account button, and a shell that survives a visit to another page.
const view = parseMapView(fixture) as MapView
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.documentElement.style.colorScheme = ''; applyLanguage('en'); localStorage.clear() })
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function settle() { await flushPromises(); await frame() }
async function until(check: () => boolean) { await expect.poll(async () => { await flushPromises(); return check() }, { timeout: 5000 }).toBe(true) }
const button = (text: string) => wrapper!.findAll('button').find(item => item.text().trim() === text)
async function shot(name: string) {
  expect(document.documentElement.scrollWidth, `${name}: page overflow`).toBeLessThanOrEqual(innerWidth)
  await page.screenshot({ path: screenshotPath(`settings-${name}.png`) })
}

function desktop() {
  let consumer: SecretsView['consumer'] = { id: 'mac-fixture-consumer', registeredAt: 1 }
  const secrets = vi.fn(async (command: { type: string }) => {
    if (command.type === 'revokeConsumer') consumer = null
    return { consumer, requests: [], origin: 'https://secrets.example.invalid' }
  })
  const workspace = vi.fn(async (command: { type: string }) => command.type === 'map' ? { pods: structuredClone(pods), map: structuredClone(view) } : { pods: structuredClone(pods) })
  installWorkspace({
    workspace,
    secrets,
    mcpSession: async () => ({ expiresAt: view.at + 3600000, pending: false }),
    onboarding: async () => ({ owner: 'owner', complete: true, runtime: { ready: true, error: null }, connections: [{ id: 'owner', provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null }] }),
    central: async (command: Record<string, unknown>) => command.type === 'status' ? { enabled: false } : { requestError: { status: 400, message: 'No fixture change feed' } },
    sharing: async () => { throw new Error('No sharing fixture configured') },
  } as never)
  return { workspace, secrets }
}

it.each([[1280, 'en', false], [390, 'de', true]] as const)('opens one settings page from the gear and returns to the kept shell (%i px, %s)', async (width, language, dark) => {
  const { workspace, secrets } = desktop()
  await page.viewport(width, 900)
  applyLanguage(language); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  wrapper = mount(DesktopWorkspace, { attachTo: document.body })
  await until(() => wrapper!.find('.automations-list').exists())
  const label = (en: string, de: string) => language === 'en' ? en : de

  await button(label('⚙ Settings', '⚙ Einstellungen'))!.trigger('click'); await settle()
  // The gear opens the page; there is no second settings panel.
  expect(wrapper.findAll('.app-settings')).toHaveLength(1)
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  await until(() => wrapper!.find('[data-consumer]').text().includes('mac-fixture-consumer'))
  // Each account, session and backup control exists exactly once.
  for (const control of [label('Manage existing grants at the IdP', 'Bestehende Grants am IdP verwalten'), label('End session', 'Sitzung beenden'), label('Revoke', 'Widerrufen'), label('Import…', 'Importieren…')]) {
    expect(wrapper.findAll('button').filter(item => item.text().trim() === control), control).toHaveLength(1)
  }
  expect(wrapper.findAll('.app-settings details summary').filter(item => item.text().includes(label('Data & backups', 'Daten & Sicherungen')))).toHaveLength(1)
  await shot(`desktop-${width}-${language}`)
  wrapper.get('.rights-settings').element.scrollIntoView(); await frame()
  await shot(`desktop-${width}-${language}-rights-secrets`)
  window.scrollTo(0, 0)
  await button(label('Revoke', 'Widerrufen'))!.trigger('click'); await settle()
  expect(secrets).toHaveBeenCalledWith({ type: 'revokeConsumer' })
  expect(wrapper.get('[data-consumer]').text()).toContain(label('Not registered', 'Nicht registriert'))

  // Back on the shell the last map is there at once: no reload message, no new first read.
  await wrapper.get('[data-testid="back-to-automations"]').trigger('click')
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).not.toContain(label('Loading workspace…', 'Arbeitsbereich wird geladen…'))
  expect(wrapper.find('.automations-list').isVisible()).toBe(true)

  // A Pod page keeps the shell mounted and pauses its polling until the owner returns.
  await (wrapper.vm as unknown as { openPod: (id: string) => Promise<void> }).openPod(view.pods[0]!.id); await settle()
  expect(wrapper.find('.automations-shell').isVisible()).toBe(false)
  const reads = workspace.mock.calls.filter(([command]) => command.type === 'map').length
  await new Promise(resolve => setTimeout(resolve, 1500)); await flushPromises()
  expect(workspace.mock.calls.filter(([command]) => command.type === 'map')).toHaveLength(reads)
  await wrapper.get('[data-testid="back-to-automations"]').trigger('click')
  await wrapper.vm.$nextTick()
  expect(wrapper.text()).not.toContain(label('Loading workspace…', 'Arbeitsbereich wird geladen…'))
  expect(wrapper.find('.automations-list').isVisible()).toBe(true)
  await shot(`returned-${width}-${language}`)
  await until(() => workspace.mock.calls.filter(([command]) => command.type === 'map').length > reads)
})

it.each([[1280, false], [390, true]] as const)('shows the browser account with sign-out and points to the desktop for native settings (%i px)', async (width, dark) => {
  await page.viewport(width, 900)
  applyLanguage('de'); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  wrapper = mount(AppSettings, { attachTo: document.body, props: { browser: true, subject: 'owner@example.invalid', sharing: true } }); await settle()
  expect(wrapper.get('[data-account="ddisa"]').text()).toContain('owner@example.invalid')
  expect(wrapper.get('[data-mcp]').text()).toContain('Verwalte den Agenten-Zugriff in der Desktop-App.')
  expect(wrapper.get('a.manage-grants').attributes('href')).toBe('https://id.openape.ai/grants')
  expect(wrapper.find('[data-consumer]').exists()).toBe(false)
  await shot(`browser-${width}`)
  await button('Abmelden')!.trigger('click')
  await button('Importieren…')!.trigger('click')
  expect(wrapper.emitted('logout')).toHaveLength(1)
  expect(wrapper.emitted('import')).toHaveLength(1)
})

it.each([[1060, 'en', false], [390, 'de', true]] as const)('edits model API formats using production CSS without overflow (%i px, %s)', async (width, language, dark) => {
  const { default: ProxyConnection } = await import('../../src/renderer/ProxyConnection.vue')
  await page.viewport(width, 900); applyLanguage(language); document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  const onboarding = vi.fn(async () => ({ owner: null, complete: true, runtime: { ready: true, error: null }, connections: [], proxy: { configured: true, enabled: true, available: true, hash: 'a'.repeat(64), mappings: [], connections: [{ id: 'openai', enabled: true, baseUrl: 'http://127.0.0.1:8317/v1', authentication: 'token', hasToken: true, format: 'chat-completions', defaultThinking: 'medium' }, { id: 'anthropic', enabled: true, baseUrl: 'http://127.0.0.1:8317/v1', authentication: 'none', hasToken: false, format: 'messages', defaultThinking: 'high' }] } }))
  window.pods = { modelApiSettings: true, onboarding } as unknown as typeof window.pods
  wrapper = mount(ProxyConnection, { attachTo: document.body }); await settle()
  wrapper.element.setAttribute('style', 'max-width:720px;margin:auto;padding:16px;box-sizing:border-box')
  await wrapper.findAll('select')[0].setValue('responses'); await settle()
  expect(wrapper.findAll('select')[0].element.value).toBe('responses')
  expect(wrapper.findAll('fieldset')).toHaveLength(2)
  expect(wrapper.findAll('input[type=password]')).toHaveLength(0)
  for (const element of wrapper.findAll('input,select,button,fieldset')) {
    const box = element.element.getBoundingClientRect(); expect(box.right).toBeLessThanOrEqual(width); expect(box.left).toBeGreaterThanOrEqual(0)
  }
  await shot(`model-apis-${width}-${language}`)
  await wrapper.findAll('button').find(item => item.text() === (language === 'de' ? 'Ersetzen' : 'Replace'))?.trigger('click'); await settle()
  expect(wrapper.find('input[type=password]').exists()).toBe(true)
  await wrapper.get('input[type=password]').setValue('synthetic-token'); await wrapper.get('form').trigger('submit'); await settle()
  expect(wrapper.html()).not.toContain('synthetic-token')
})
