import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import AccountStatus from '../../src/renderer/AccountStatus.vue'
import Onboarding from '../../src/renderer/Onboarding.vue'
import type { OnboardingView } from '../../src/contracts/onboarding'

const state: OnboardingView = { connections: [
  { id: '00000000-0000-4000-8000-000000000002', provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null },
  { id: '00000000-0000-4000-8000-000000000003', provider: 'microsoft', account: 'mail@example.invalid', state: 'ready', error: null, login: null },
], defaultOwner: null, runtime: { ready: true, error: null }, complete: false }
it('offers only model and OpenApe accounts and directs program setup to Permissions', async () => {
  const onboarding = vi.fn(async () => state)
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  expect(wrapper.findAll('select[aria-label="Connection"] option').map(item => item.attributes('value'))).toEqual(['chatgpt', 'openape'])
  expect(wrapper.text()).toContain('Microsoft and Telegram have separate connections')
  expect(wrapper.text()).not.toContain('mail@example.invalid')
  expect(wrapper.text()).not.toContain('Assign mail')
  expect(wrapper.text()).toContain('Open pod permissions')
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
it('selects the account explicitly and keeps issuer settings under Advanced', async () => {
  const onboarding = vi.fn(async command => ({ ...state, defaultOwner: command.type === 'setDefaultOwner' ? command.id : null }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  expect(wrapper.text()).toContain('Choose an account for new pods')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  expect(wrapper.get('details').text()).toContain('Identity provider')
  await wrapper.findAll('button').find(button => button.text() === 'Use for new pods')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'setDefaultOwner', id: state.connections[0].id })
  expect(wrapper.text()).toContain('Default for new pods')
  await wrapper.get('input[type="email"]').setValue('new@example.invalid')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'new@example.invalid', issuer: 'https://id.openape.ai', makeDefault: true })
  wrapper.unmount()
})
it('requires a visible disconnect confirmation and offers reconnect for the same account', async () => {
  const onboarding = vi.fn(async command => ({ ...state, connections: [{ ...state.connections[0], state: command.type === 'disconnect' ? 'revoked' : 'ready' }] }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('affected pods paused')
  await wrapper.findAll('button').find(button => button.text() === 'Confirm disconnect')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'disconnect', id: state.connections[0].id })
  await wrapper.findAll('button').find(button => button.text() === 'Sign in again')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'reconnect', id: state.connections[0].id })
  wrapper.unmount()
})

it('shows the selected identity persistently and opens account management', async () => {
  window.pods = { onboarding: vi.fn(async () => ({ ...state, defaultOwner: state.connections[0].id })) } as unknown as typeof window.pods
  const wrapper = mount(AccountStatus); await flushPromises()
  expect(wrapper.text()).toContain('owner@example.invalid'); expect(wrapper.text()).toContain('Signed in')
  await wrapper.get('button').trigger('click'); expect(wrapper.emitted('open')).toHaveLength(1)
  wrapper.unmount()
})
it('shows an account status failure instead of a signed-in claim', async () => {
  window.pods = { onboarding: vi.fn(async () => { throw new Error('Worker unavailable') }) } as unknown as typeof window.pods
  const wrapper = mount(AccountStatus); await flushPromises()
  expect(wrapper.text()).toContain('Account status unavailable')
  expect(wrapper.text()).not.toContain('Signed in'); wrapper.unmount()
})

it('requires an explicit provider consent and shows its limited authority before sending it', async () => {
  const id = state.connections[0].id
  const onboarding = vi.fn(async command => ({ ...state, connections: [{ ...state.connections[0], ...(command.type === 'enableBroker' ? { broker: { issuer: command.issuer, domain: command.domain, connectionId: id } } : {}) }] }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Connect agent provider')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('It cannot approve actions')
  expect(wrapper.text()).toContain('existing pods keep their assigned provider')
  await wrapper.get('form.disconnect-review').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'enableBroker', id, issuer: 'https://pods.openape.ai', domain: 'pods.openape.ai' })
  expect(wrapper.text()).toContain('Agent provider: pods.openape.ai')
  wrapper.unmount()
})
