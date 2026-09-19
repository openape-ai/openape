import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import AccountStatus from '../../src/renderer/AccountStatus.vue'
import PodIdentity from '../../src/renderer/PodIdentity.vue'
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
  expect(wrapper.text()).toContain('Your DDISA identity')
  expect(wrapper.text()).not.toContain('Allow requests from this provider')
  expect(wrapper.text()).not.toContain('References and first run')
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
  const onboarding = vi.fn(async command => ({ ...state, podIdentity: { podId: id, bound: false, ownerConnection: id, issuer: null, decisionIssuer: null, subject: null, brokerConnectionId: null }, connections: [{ ...state.connections[0], ...(command.type === 'enableBroker' ? { broker: { issuer: command.issuer, domain: command.domain, connectionId: id } } : {}) }] }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(PodIdentity, { props: { podId: id } }); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Allow requests from this provider')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('No additional sign-in at the agent provider is needed.')
  expect(wrapper.get('form button.primary').text()).toBe('Confirm permission')
  expect(wrapper.text()).toContain('It cannot approve actions')
  expect(wrapper.text()).toContain('existing pods keep their assigned provider')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenCalledWith({ type: 'enableBroker', id, issuer: 'https://pods.openape.ai', domain: 'pods.openape.ai' })
  expect(wrapper.text()).toContain('applies across its pods')
  wrapper.unmount()
})

it('shows the assigned pod owner rather than the current default and links to personal accounts', async () => {
  const id = state.connections[0].id
  const onboarding = vi.fn(async () => ({ ...state, defaultOwner: 'other', connections: [{ ...state.connections[0], state: 'revoked' }, { ...state.connections[0], id: 'other', account: 'other@example.invalid' }], podIdentity: { podId: id, bound: true, ownerConnection: id, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://id.example.invalid', subject: 'agent@pods.example.invalid', brokerConnectionId: 'old-consent' } }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(PodIdentity, { props: { podId: id } }); await flushPromises()
  expect(wrapper.text()).toContain('owner@example.invalid')
  expect(wrapper.text()).not.toContain('other@example.invalid')
  expect(wrapper.text()).toContain('agent@pods.example.invalid')
  expect(wrapper.text()).toContain('A new consent does not restore this identity')
  expect(wrapper.text()).toContain('Sign in to this pod’s assigned DDISA account again')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  await wrapper.findAll('button').find(button => button.text() === 'Manage your accounts')!.trigger('click')
  expect(wrapper.emitted('accounts')).toHaveLength(1)
  expect(onboarding).toHaveBeenCalledExactlyOnceWith({ type: 'list', podId: id })
  wrapper.unmount()
})
it('explains a missing owner without provisioning or offering global sign-in inside the pod', async () => {
  const id = state.connections[0].id
  const onboarding = vi.fn(async () => ({ ...state, connections: [], podIdentity: { podId: id, bound: false, ownerConnection: null, issuer: null, decisionIssuer: null, subject: null, brokerConnectionId: null } }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(PodIdentity, { props: { podId: id } }); await flushPromises()
  expect(wrapper.text()).toContain('Connect your DDISA account')
  expect(wrapper.find('form').exists()).toBe(false)
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('accounts')).toHaveLength(1)
  expect(onboarding).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('confirms the account-wide impact before revoking provider consent', async () => {
  const id = state.connections[0].id
  const onboarding = vi.fn(async () => ({ ...state, connections: [{ ...state.connections[0], broker: { issuer: 'https://pods.example.invalid', domain: 'pods.example.invalid', connectionId: id } }], podIdentity: { podId: id, bound: true, ownerConnection: id, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://id.example.invalid', subject: 'agent@pods.example.invalid', brokerConnectionId: id } }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(PodIdentity, { props: { podId: id } }); await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Revoke provider permission')!.trigger('click')
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('This affects all pods')
  await wrapper.findAll('button').find(button => button.text() === 'Confirm revocation')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenCalledWith({ type: 'revokeBroker', id })
  wrapper.unmount()
})
