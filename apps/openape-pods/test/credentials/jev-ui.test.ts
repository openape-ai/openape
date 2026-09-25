import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import JevConnection from '../../src/renderer/JevConnection.vue'
import type { OnboardingView } from '../../src/contracts/onboarding'

it('keeps connected key setup minimal and reports a failed replacement without losing the saved state', async () => {
  const view: OnboardingView = { connections: [{ id: '00000000-0000-4000-8000-000000000001', provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null, login: null }], owner: null, runtime: { ready: true, error: null }, complete: false }
  const onboarding = vi.fn(async () => view)
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(JevConnection); await flushPromises()
  expect(wrapper.get('label').text()).toBe('TypeSafe AI - Jev - API Key')
  expect(wrapper.get('button').text()).toBe('Connect or replace API key')
  expect(wrapper.find('p').exists()).toBe(false)
  expect(wrapper.findAll('button')).toHaveLength(1)
  expect(wrapper.find('a').exists()).toBe(false)
  expect(wrapper.get('input').attributes('placeholder')).toBe('••••••••')
  onboarding.mockRejectedValueOnce(new Error('TypeSafe connection failed'))
  await wrapper.get('input').setValue('synthetic-replacement')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('TypeSafe connection failed')
  expect(wrapper.get('input').attributes('placeholder')).toBe('••••••••')
  expect(wrapper.text()).not.toContain('synthetic-replacement')
  wrapper.unmount()
})
