import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import AccountStatus from '../../src/renderer/AccountStatus.vue'
import PodIdentity from '../../src/renderer/PodIdentity.vue'
import Onboarding from '../../src/renderer/Onboarding.vue'
import type { OnboardingView } from '../../src/contracts/onboarding'

const owner = '00000000-0000-4000-8000-000000000002'
const codex = '00000000-0000-4000-8000-000000000005'
const state: OnboardingView = { connections: [
  { id: owner, provider: 'openape', account: 'owner@example.invalid', state: 'ready', error: null, login: null },
  { id: '00000000-0000-4000-8000-000000000003', provider: 'microsoft', account: 'mail@example.invalid', state: 'ready', error: null, login: null },
  { id: codex, provider: 'chatgpt', account: 'model@example.invalid', state: 'ready', error: null, login: null },
], owner, runtime: { ready: true, error: null }, complete: false }
const buttons = (wrapper: ReturnType<typeof mount>, section: string) => wrapper.get(`section[aria-label="${section}"]`).findAll('button').map(button => button.text())
async function page(view: OnboardingView) {
  const onboarding = vi.fn(async (_command: unknown) => view)
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  return { wrapper, onboarding }
}

it('shows exactly the Codex and DDISA accounts and nothing else', async () => {
  const { wrapper } = await page(state)
  expect(wrapper.findAll('section.setup-connection').map(item => item.attributes('aria-label'))).toEqual(['Codex / GPT account', 'Your DDISA account'])
  for (const hidden of ['mail@example.invalid', 'Telegram', 'Microsoft', 'Expected account', 'Identity provider', 'Default for new pods', 'Use for new pods', 'Allow requests from this provider']) expect(wrapper.text()).not.toContain(hidden)
  expect(wrapper.findAll('select')).toHaveLength(0)
  expect(wrapper.findAll('input')).toHaveLength(1)
  wrapper.unmount()
})
it('offers sign-in for both accounts when neither is signed in', async () => {
  const { wrapper, onboarding } = await page({ ...state, connections: [], owner: null })
  expect(wrapper.text().match(/Not signed in/g)).toHaveLength(2)
  expect(buttons(wrapper, 'Codex / GPT account')).toEqual(['Sign in'])
  expect(buttons(wrapper, 'Your DDISA account')).toEqual(['Sign in'])
  await wrapper.get('section[aria-label="Codex / GPT account"] button').trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'chatgpt', account: '' })
  await wrapper.get('input[type="email"]').setValue('owner@example.invalid')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'owner@example.invalid' })
  wrapper.unmount()
})
it('shows both signed-in accounts with their addresses', async () => {
  const { wrapper } = await page(state)
  expect(wrapper.get('section[aria-label="Codex / GPT account"]').text()).toContain('model@example.invalid · Signed in')
  expect(wrapper.get('section[aria-label="Your DDISA account"]').text()).toContain('owner@example.invalid · Signed in')
  expect(buttons(wrapper, 'Codex / GPT account')).toEqual(['Disconnect'])
  expect(buttons(wrapper, 'Your DDISA account')).toEqual(['Sign in again', 'Disconnect'])
  expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe('owner@example.invalid')
  wrapper.unmount()
})
it.each([['Codex / GPT account', codex, { type: 'connect', provider: 'chatgpt', account: '' }], ['Your DDISA account', owner, { type: 'connect', provider: 'openape', account: 'owner@example.invalid' }]] as const)('asks to sign in again when the %s expired', async (section, id, command) => {
  const { wrapper, onboarding } = await page({ ...state, connections: state.connections.map(item => item.id === id ? { ...item, state: 'expired', error: 'Sign-in expired; reconnect' } : item) })
  expect(wrapper.get(`section[aria-label="${section}"]`).text()).toContain('Sign-in expired')
  const again = wrapper.get(`section[aria-label="${section}"]`).findAll('button').find(button => button.text() === 'Sign in again')!
  await (again.element.closest('form') ? wrapper.get('form').trigger('submit') : again.trigger('click')); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith(command)
  wrapper.unmount()
})
it('confirms before switching the DDISA account', async () => {
  const { wrapper, onboarding } = await page(state)
  await wrapper.get('input[type="email"]').setValue('other@example.invalid')
  expect(buttons(wrapper, 'Your DDISA account')).toContain('Switch account')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('Your pods receive new agents under this account')
  await wrapper.findAll('button').find(button => button.text() === 'Confirm switch')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'connect', provider: 'openape', account: 'other@example.invalid', switchAccount: true })
  wrapper.unmount()
})
it('shows device sign-in and cancels only that pending connection', async () => {
  const { wrapper, onboarding } = await page({ ...state, connections: [{ id: codex, provider: 'chatgpt', account: '', state: 'connecting', error: null, login: { url: 'https://auth.openai.com/codex/device', code: 'SYNTHETIC' } }], owner: null })
  expect(wrapper.text()).toContain('SYNTHETIC')
  await wrapper.findAll('button').find(button => button.text() === 'Cancel sign-in')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'cancel', id: codex }); wrapper.unmount()
})
it('requires a visible disconnect confirmation', async () => {
  const { wrapper, onboarding } = await page(state)
  await wrapper.get('section[aria-label="Your DDISA account"]').findAll('button').find(button => button.text() === 'Disconnect')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('affected pods paused')
  await wrapper.findAll('button').find(button => button.text() === 'Confirm disconnect')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'disconnect', id: owner })
  wrapper.unmount()
})

it('shows the selected identity persistently and opens account management', async () => {
  window.pods = { onboarding: vi.fn(async () => state) } as unknown as typeof window.pods
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
  expect(wrapper.get('form').text()).toContain('https://pods.openape.ai'); expect(wrapper.find('form input').exists()).toBe(false)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(onboarding).toHaveBeenCalledWith({ type: 'enableBroker', id, issuer: 'https://pods.openape.ai', domain: 'pods.openape.ai' })
  expect(wrapper.text()).toContain('applies across its pods')
  wrapper.unmount()
})

it('shows the assigned pod owner rather than the current default and links to personal accounts', async () => {
  const id = state.connections[0].id
  const onboarding = vi.fn(async () => ({ ...state, connections: [{ ...state.connections[0], state: 'revoked' }], podIdentity: { podId: id, bound: true, ownerConnection: id, issuer: 'https://pods.example.invalid', decisionIssuer: 'https://id.example.invalid', subject: 'agent@pods.example.invalid', brokerConnectionId: 'old-consent' } }))
  window.pods = { onboarding } as unknown as typeof window.pods
  const wrapper = mount(PodIdentity, { props: { podId: id } }); await flushPromises()
  expect(wrapper.text()).toContain('owner@example.invalid')
  expect(wrapper.text()).toContain('agent@pods.example.invalid')
  expect(wrapper.text()).toContain('A new consent does not restore this identity')
  expect(wrapper.text()).toContain('Sign in to your DDISA account again')
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
  expect(wrapper.text()).toContain('Sign in with your DDISA account')
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
