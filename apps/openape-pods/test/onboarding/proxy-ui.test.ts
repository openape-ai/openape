import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ProxyConnection from '../../src/renderer/ProxyConnection.vue'
import AppSettings from '../../src/renderer/AppSettings.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import type { AgentBackendStatus } from '../../src/contracts/agent-status'
import type { OnboardingCommand, OnboardingView } from '../../src/contracts/onboarding'

afterEach(() => applyLanguage('en'))
const status = (patch: Partial<AgentBackendStatus> = {}): AgentBackendStatus => ({ configured: true, enabled: true, available: true, revision: 'fixture-1', hash: 'a'.repeat(64), mappings: [{ provider: 'claude', modelSize: 'medium', modelId: 'claude-sonnet-5-5', enabled: true, defaultThinking: 'medium', thinking: ['low', 'medium', 'high', 'xhigh'], capabilityEvidenceVersion: 'fixture-only' }], connections: [{ id: 'openai', enabled: true, baseUrl: 'http://127.0.0.1:8317/v1', format: 'chat-completions', authentication: 'token', hasToken: true, defaultThinking: 'medium' }, { id: 'anthropic', enabled: true, baseUrl: 'http://127.0.0.1:8317/v1', format: 'messages', authentication: 'none', hasToken: false, defaultThinking: 'high' }], ...patch })
const view = (proxy: AgentBackendStatus): OnboardingView => ({ proxy, connections: [], owner: null, runtime: { ready: true, error: null }, complete: true })

it.each(['en', 'de'] as const)('edits both API connections, selects Responses and saves a transient token without a model pin (%s)', async (language) => {
  applyLanguage(language)
  const onboarding = vi.fn(async (_command: OnboardingCommand) => view(status()))
  window.pods = { onboarding, modelApiSettings: true } as unknown as typeof window.pods
  const wrapper = mount(ProxyConnection); await flushPromises()
  expect(wrapper.findAll('fieldset')).toHaveLength(2)
  expect(wrapper.text()).toContain(language === 'de' ? 'OpenAI-kompatibel' : 'OpenAI-compatible')
  expect(wrapper.text()).toContain('claude-sonnet-5-5')
  expect(wrapper.findAll('input').some(input => input.attributes('value')?.includes('claude-'))).toBe(false)
  const openai = wrapper.findAll('fieldset')[0]
  await openai.findAll('select')[0].setValue('responses')
  await openai.findAll('button')[0].trigger('click')
  await openai.get('input[type=password]').setValue('synthetic-secret')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenCalledWith(expect.objectContaining({ type: 'saveModelApis', settings: expect.objectContaining({ expectedHash: 'a'.repeat(64), connections: expect.objectContaining({ openai: expect.objectContaining({ format: 'responses', token: 'synthetic-secret' }), anthropic: expect.objectContaining({ format: 'messages', authentication: 'none' }) }) }) }))
  expect(wrapper.find('input[type=password]').exists()).toBe(false)
  expect(wrapper.html()).not.toContain('synthetic-secret')
  expect(wrapper.text()).not.toMatch(/CLIProxyAPI|Keychain|Schlüsselbund|simulation|simuliert|Codex nativ bleibt|agent-backends.json/)
  wrapper.unmount()
})

it('checks only saved connection IDs and disables changes during a pending operation', async () => {
  let rejectReload: (error: Error) => void = () => undefined
  const onboarding = vi.fn((command: OnboardingCommand) => command.type === 'reloadProxy' ? new Promise<OnboardingView>((_resolve, reject) => { rejectReload = reject }) : Promise.resolve(view(status())))
  window.pods = { onboarding, modelApiSettings: true } as unknown as typeof window.pods
  const wrapper = mount(ProxyConnection); await flushPromises()
  const check = wrapper.findAll('button').find(button => button.text() === 'Check connection')
  await check?.trigger('click'); await flushPromises(); expect(onboarding).toHaveBeenLastCalledWith({ type: 'checkModelApi', id: 'openai' })
  await wrapper.findAll('button').find(button => button.text() === 'Reload configuration')?.trigger('click')
  expect(wrapper.findAll('fieldset').every(field => field.attributes('disabled') !== undefined)).toBe(true)
  rejectReload(new Error('Model API configuration changed; reload before saving')); await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toContain('changed')
  expect(wrapper.findAll('fieldset').every(field => field.attributes('disabled') === undefined)).toBe(true)
  wrapper.unmount()
})

it('shows invalid configuration causes without claiming inference acceptance', async () => {
  window.pods = { modelApiSettings: true, onboarding: async () => view(status({ available: false, error: { code: 'proxy_not_configured', message: 'Invalid API configuration', details: { phase: 'resolve' } } })) } as unknown as typeof window.pods
  const wrapper = mount(ProxyConnection); await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toContain('Invalid API configuration')
  expect(wrapper.text()).not.toMatch(/Inference successful|Verified model/)
  wrapper.unmount()
})

it('keeps token editing local and model API controls out of browser settings', async () => {
  const onboarding = vi.fn(async () => view(status()))
  window.pods = { onboarding } as unknown as typeof window.pods
  const readOnly = mount(ProxyConnection); await flushPromises()
  expect(readOnly.findAll('fieldset').every(field => field.attributes('disabled') !== undefined)).toBe(true)
  expect(readOnly.findAll('button').some(button => button.text() === 'Save')).toBe(false)
  readOnly.unmount(); onboarding.mockClear()
  const wrapper = mount(AppSettings, { props: { browser: true, subject: 'fixture@example.invalid' }, global: { stubs: { LanguageSwitcher: true } } }); await flushPromises()
  expect(wrapper.find('.proxy-connection').exists()).toBe(false); expect(onboarding).not.toHaveBeenCalled(); wrapper.unmount()
})
