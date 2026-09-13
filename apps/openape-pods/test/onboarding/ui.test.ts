import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import Onboarding from '../../src/renderer/Onboarding.vue'
import type { OnboardingCommand, OnboardingView } from '../../src/contracts/onboarding'

const pod = { id: '00000000-0000-4000-8000-000000000001', revision: 1, name: 'Mail knowledge', assignment: 'Read evidence', lifecycle: 'paused' as const, activeScript: null }
const owner = { id: '00000000-0000-4000-8000-000000000002', provider: 'openape' as const, account: 'owner@example.invalid', state: 'ready' as const, error: null, login: null }
const mail = { ...owner, id: '00000000-0000-4000-8000-000000000003', provider: 'microsoft' as const, account: 'mail@example.invalid' }
const state: OnboardingView = { connections: [owner, mail], runtime: { ready: true, error: null }, complete: false }
it('requires exact resource review, resets consent on assignment changes and surfaces denial', async () => {
  const onboarding = vi.fn(async (command: OnboardingCommand): Promise<OnboardingView> => {
    if (command.type === 'folders') return { ...state, folders: { connectionId: mail.id, items: [{ id: 'inbox', name: 'Inbox' }, { id: 'rules', name: 'Orders' }] } }
    if (command.type === 'assign') throw new Error('Permission was denied')
    return state
  })
  window.pods = { data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding, { props: { pod } }); await flushPromises()
  await wrapper.get('select[aria-label="OpenApe owner"]').setValue(owner.id); await wrapper.get('select[aria-label="Microsoft account"]').setValue(mail.id)
  await wrapper.findAll('button').find(button => button.text() === 'Load folder names')!.trigger('click'); await flushPromises()
  await wrapper.get('.setup-folders input').setValue(true)
  const assign = () => wrapper.findAll('button').find(button => button.text() === 'Review and assign read-only mail')!
  expect(assign().attributes('disabled')).toBeDefined()
  await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
  expect(assign().attributes('disabled')).toBeUndefined()
  await wrapper.setProps({ pod: { ...pod, revision: 2 } }); expect(assign().attributes('disabled')).toBeDefined()
  await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
  await assign().trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'assign', setup: { podId: pod.id, revision: 2, ownerConnection: owner.id, mailConnection: mail.id, account: mail.account, folders: [{ id: 'inbox', name: 'Inbox' }], since: expect.stringMatching(/T00:00:00Z$/), attachments: false } })
  expect(wrapper.get('[role="alert"]').text()).toBe('Permission was denied')
  expect(wrapper.text()).toContain('may be sent to ChatGPT'); expect(wrapper.emitted('assigned')).toBeUndefined()
  wrapper.unmount()
})
it('shows device sign-in and cancels only that pending connection', async () => {
  const pending = { ...mail, state: 'connecting' as const, login: { url: 'https://microsoft.com/devicelogin', code: 'SYNTHETIC' } }
  const onboarding = vi.fn(async (): Promise<OnboardingView> => ({ ...state, connections: [pending] }))
  window.pods = { data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }), onboarding } as unknown as typeof window.pods
  const wrapper = mount(Onboarding); await flushPromises()
  expect(wrapper.text()).toContain('SYNTHETIC')
  await wrapper.findAll('button').find(button => button.text() === 'Cancel sign-in')!.trigger('click'); await flushPromises()
  expect(onboarding).toHaveBeenLastCalledWith({ type: 'cancel', id: mail.id }); wrapper.unmount()
})
