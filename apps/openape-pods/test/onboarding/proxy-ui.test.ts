import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ProxyConnection from '../../src/renderer/ProxyConnection.vue'
import AppSettings from '../../src/renderer/AppSettings.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { AgentBackendStatus } from '../../src/contracts/agent-status'
import type { OnboardingCommand, OnboardingView } from '../../src/contracts/onboarding'

afterEach(() => applyLanguage('en'))
const status = (patch: Partial<AgentBackendStatus> = {}): AgentBackendStatus => ({ configured: true, enabled: true, available: true, revision: 'fixture-revision-1', hash: 'a'.repeat(64), mappings: [{ provider: 'claude', modelSize: 'medium', modelId: 'claude-sonnet-5-5', enabled: true, defaultThinking: 'medium', thinking: ['low', 'medium', 'high', 'xhigh'], capabilityEvidenceVersion: 'fixture-only' }], ...patch })
const view = (proxy: AgentBackendStatus): OnboardingView => ({ connections: [], owner: null, runtime: { ready: true, error: null }, complete: false, proxy })

it.each(['en', 'de'] as const)('shows safe mappings and sends explicit reload and disable commands from app settings (%s)', async (language) => {
  applyLanguage(language)
  const onboarding = vi.fn(async (command: OnboardingCommand) => view(status(command.type === 'disableProxy' ? { enabled: false, available: false } : command.type === 'reloadProxy' ? { revision: 'fixture-revision-2' } : {})))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(AppSettings, { global: { stubs: { JevConnection: true, McpSession: true, DataManagement: true, LanguageSwitcher: true } } }); await flushPromises()
  const section = wrapper.get('section[aria-label="CLIProxyAPI"]')
  expect(onboarding).toHaveBeenCalledWith({ type: 'proxyStatus' })
  expect(section.get('[role="status"]').text()).toBe(language === 'de' ? 'Konfiguriert und aktiviert' : 'Configured and enabled')
  expect(section.text()).toContain('claude-sonnet-5-5')
  expect(section.text()).toContain(language === 'de' ? 'Mittel' : 'Medium')
  expect(section.findAll('input, select')).toHaveLength(0)
  expect(section.text()).not.toMatch(/api_key|Authorization|keyFile|http:\/\//)
  const reload = section.findAll('button').find(button => button.text() === (language === 'de' ? 'Konfiguration neu laden' : 'Reload configuration'))!
  await reload.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'reloadProxy' })
  expect(section.text()).toContain('fixture-revision-2')
  const disable = section.findAll('button').find(button => button.text() === (language === 'de' ? 'Proxy deaktivieren' : 'Disable proxy'))!
  await disable.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'disableProxy' })
  expect(section.get('[role="status"]').text()).toBe(language === 'de' ? 'Deaktiviert' : 'Disabled')
  expect((disable.element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})

it.each(['en', 'de'] as const)('disables actions during a reload and translates its actual failure without claiming a new configuration (%s)', async (language) => {
  applyLanguage(language)
  let rejectReload: (error: Error) => void = () => {}
  const onboarding = vi.fn((command: OnboardingCommand) => command.type === 'reloadProxy' ? new Promise<OnboardingView>((_resolve, reject) => { rejectReload = reject }) : Promise.resolve(view(status())))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(ProxyConnection); await flushPromises()
  await wrapper.findAll('button')[0]!.trigger('click')
  for (const button of wrapper.findAll('button')) expect((button.element as HTMLButtonElement).disabled).toBe(true)
  rejectReload(new Error('Changing the proxy connection requires an idle runtime restart')); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe(language === 'de' ? 'Eine Änderung der Proxy-Verbindung benötigt einen Neustart der Runtime im Leerlauf' : 'Changing the proxy connection requires an idle runtime restart')
  expect(wrapper.text()).toContain('fixture-revision-1')
  for (const button of wrapper.findAll('button')) expect((button.element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})

it('renders missing and invalid configurations without enabled or inference-verified claims', async () => {
  for (const proxy of [status({ configured: false, enabled: false, available: false, mappings: [] }), status({ available: false, error: { code: 'proxy_not_configured', message: 'Model configuration contains an unsupported mapping', details: { phase: 'resolve' } } })]) {
    window.pods = { onboarding: async () => view(proxy) } as unknown as typeof window.pods
    const wrapper = mount(ProxyConnection); await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe(proxy.configured ? 'Unavailable' : 'Not configured')
    if (proxy.error) expect(wrapper.get('[role="alert"]').text()).toBe(proxy.error.message)
    expect(wrapper.text()).not.toMatch(/Verified|Inference successful|Connected and ready/)
    wrapper.unmount()
  }
})

it('keeps host-only proxy controls out of browser settings', async () => {
  const onboarding = vi.fn()
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(AppSettings, { props: { browser: true, subject: 'fixture@example.invalid' }, global: { stubs: { LanguageSwitcher: true } } }); await flushPromises()
  expect(wrapper.find('section[aria-label="CLIProxyAPI"]').exists()).toBe(false)
  expect(onboarding).not.toHaveBeenCalled()
  wrapper.unmount()
})
