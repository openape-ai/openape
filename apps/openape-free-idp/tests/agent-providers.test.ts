// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AgentProviders from '../app/pages/agent-providers.vue'

const connection = { id: 'fixture-connection', owner: { issuer: 'https://id.example.test', subject: 'owner@example.test' }, broker_issuer: 'https://pods.example.test', agent_domain: 'pods.example.test', status: 'active', created_at: 1 }
const stubs = { IdpPage: { template: '<section><slot /></section>' }, UButton: { template: '<button><slot /></button>' } }
afterEach(() => { vi.unstubAllGlobals() })
it('shows connection authority and requires confirmation before revoking reusable grants', async () => {
  vi.stubGlobal('useSeoMeta', vi.fn())
  const request = vi.fn(async (_url: string, options?: { method?: string }) => options?.method === 'DELETE' ? {} : [connection])
  vi.stubGlobal('$fetch', request)
  const page = mount(AgentProviders, { global: { stubs } }); await flushPromises()
  expect(page.text()).toContain('Only you can approve actions')
  expect(page.text()).toContain('pods.example.test')
  await page.findAll('button').find(button => button.text() === 'Revoke provider')!.trigger('click')
  expect(request).toHaveBeenCalledTimes(1)
  expect(page.text()).toContain('including recurring permissions')
  await page.findAll('button').find(button => button.text() === 'Confirm revocation')!.trigger('click'); await flushPromises()
  expect(request).toHaveBeenCalledWith('/api/broker-connections/fixture-connection', { method: 'DELETE' })
  page.unmount()
})
it('shows failures without claiming consent or discarding the last visible connection', async () => {
  vi.stubGlobal('useSeoMeta', vi.fn())
  const request = vi.fn(async (_url: string, options?: { method?: string }) => { if (options?.method) throw new Error('Provider discovery failed'); return [connection] })
  vi.stubGlobal('$fetch', request)
  const page = mount(AgentProviders, { global: { stubs } }); await flushPromises()
  await page.get('form').trigger('submit'); await flushPromises()
  expect(page.get('[role="alert"]').text()).toContain('Provider discovery failed')
  expect(page.text()).toContain('pods.example.test')
  page.unmount()
})
