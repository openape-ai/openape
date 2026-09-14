import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import Onboarding from '../../src/renderer/Onboarding.vue'
import type { OnboardingView } from '../../src/contracts/onboarding'

const state: OnboardingView = { connections: [
  { id: '00000000-0000-4000-8000-000000000002', provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null },
  { id: '00000000-0000-4000-8000-000000000003', provider: 'microsoft', account: 'mail@example.invalid', state: 'ready', error: null, login: null },
], runtime: { ready: true, error: null }, complete: false }
it('offers only model and OpenApe accounts and directs program setup to Permissions', async () => {
  const onboarding = vi.fn(async () => state)
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  expect(wrapper.findAll('select[aria-label="Connection"] option').map(item => item.attributes('value'))).toEqual(['chatgpt', 'openape'])
  expect(wrapper.text()).not.toContain('Microsoft')
  expect(wrapper.text()).not.toContain('mail@example.invalid')
  expect(wrapper.text()).not.toContain('Assign mail')
  expect(wrapper.text()).toContain('Permissions')
  wrapper.unmount()
})
it('shows device sign-in and cancels only that pending global connection', async () => {
  const id = '00000000-0000-4000-8000-000000000004'
  const onboarding = vi.fn(async (): Promise<OnboardingView> => ({ ...state, connections: [{ id, provider: 'chatgpt', account: '', state: 'connecting', error: null, login: { url: 'https://auth.openai.com/codex/device', code: 'SYNTHETIC' } }] }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  expect(wrapper.text()).toContain('SYNTHETIC')
  await wrapper.findAll('button').find(button => button.text() === 'Cancel sign-in')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'cancel', id }); wrapper.unmount()
})
