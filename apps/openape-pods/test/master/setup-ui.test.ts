import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ChatSetupReview from '../../src/renderer/ChatSetupReview.vue'
import MasterChat from '../../src/renderer/MasterChat.vue'
import type { AccessProposal, MasterView } from '../../src/contracts/master'
import type { ResourceState } from '../../src/contracts/resources'
import { applyLanguage } from '../../src/renderer/i18n'

const podId = '11111111-1111-4111-8111-111111111111'
function proposal(body: AccessProposal['body']): AccessProposal { return { id: crypto.randomUUID(), podId, body, state: 'pending' } }
function api(state: ResourceState) {
  const resources = vi.fn().mockResolvedValue(structuredClone(state)); const master = vi.fn(); const programs = vi.fn()
  window.pods = { resources, master, programs } as unknown as typeof window.pods
  applyLanguage('en'); return { resources, master, programs }
}
it('prefills HTTP scope, retains cancellation and resolves only a saved destination', async () => {
  const state: ResourceState = { epoch: 2, resources: [] }; const { resources, master } = api(state)
  const request = proposal({ provider: 'http', origin: 'https://api.telegram.org', methods: ['POST'], description: 'Notify after filing' })
  const wrapper = mount(ChatSetupReview, { props: { proposal: request } })
  expect(resources).not.toHaveBeenCalled()
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.get<HTMLInputElement>('input[type="url"]').element.value).toBe('https://api.telegram.org')
  expect(wrapper.get<HTMLInputElement>('input[value="POST"]').element.checked).toBe(true)
  expect(wrapper.get<HTMLInputElement>('input[value="GET"]').element.checked).toBe(false)
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(master).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('Nothing was granted')
  const resourceId = crypto.randomUUID()
  resources.mockResolvedValue({ epoch: 3, resources: [{ id: resourceId, podId, state: 'ready', kind: 'tool', revision: 1, name: 'Telegram', configuration: { type: 'http', origin: request.body.origin, methods: ['POST'] } }] })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'assignHttp', podId, epoch: 2, permission: { origin: request.body.origin, methods: ['POST'] } })
  expect(master).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'resolveSetup', id: request.id, resourceId, epoch: 3 }))
  expect(wrapper.emitted('updated')).toHaveLength(1); wrapper.unmount()
})
it('uses native directory review with the exact requested path and write scope', async () => {
  const { resources, master } = api({ epoch: 0, resources: [] })
  const request = proposal({ provider: 'directory', path: '/Owner/Invoices', access: 'readWrite', description: 'File invoices' })
  const wrapper = mount(ChatSetupReview, { props: { proposal: request } })
  await wrapper.get('button').trigger('click'); await flushPromises()
  expect(wrapper.get('input').element.value).toBe('/Owner/Invoices')
  expect(wrapper.get('select').element.value).toBe('readWrite')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenLastCalledWith({ type: 'reviewDirectory', podId, epoch: 0, path: '/Owner/Invoices', access: 'readWrite' })
  expect(master).not.toHaveBeenCalled(); wrapper.unmount()
})
it('requests program grants from concrete arguments and never starts the application', async () => {
  const applicationId = crypto.randomUUID()
  const state: ResourceState = { epoch: 1, resources: [{ id: applicationId, podId, kind: 'tool', state: 'ready', revision: 1, name: 'o365-cli', configuration: { type: 'program', cliId: 'o365-cli', networkHosts: ['graph.microsoft.com'] } }] }
  const { programs, master } = api(state); programs.mockResolvedValue(state)
  const request = proposal({ provider: 'application', application: 'o365-cli', argv: ['mail', 'list', '--folder', 'Invoice Inbox'], networkHosts: ['graph.microsoft.com'], description: 'Read invoice mail' })
  const wrapper = mount(ChatSetupReview, { props: { proposal: request } })
  await wrapper.get('button').trigger('click'); await flushPromises()
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(programs).toHaveBeenCalledTimes(1)
  expect(programs).toHaveBeenCalledWith({ type: 'grant', podId, applicationId, epoch: 1, argv: request.body.argv })
  expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'resolveSetup', request: expect.objectContaining({ argv: request.body.argv }) }))
  wrapper.unmount()
})
it('preserves a missing value when a stale answer is rejected and does not send it as a model message', async () => {
  const { master } = api({ epoch: 0, resources: [], variables: [{ name: 'chat_id', value: 'PLEASE_SET_CHAT_ID', revision: 1 }] })
  master.mockRejectedValue(new Error('Variable changed; reload before saving'))
  const wrapper = mount(ChatSetupReview, { props: { proposal: proposal({ provider: 'variable', alias: 'chat_id', description: 'Which chat?' }) } })
  await wrapper.get('button').trigger('click'); await flushPromises()
  await wrapper.get('input').setValue('12345'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(master).toHaveBeenCalledWith(expect.objectContaining({ type: 'answerSetup', podId, value: '12345', revision: 1 }))
  expect(wrapper.get('[role="alert"]').text()).toContain('Variable changed')
  expect(wrapper.get('input').element.value).toBe('12345'); wrapper.unmount()
})
it('shows saved-state evidence after interruption and continues without losing the composed draft', async () => {
  const view: MasterView = { connected: true, state: 'interrupted', error: 'Master turn exceeded two minutes', scriptState: 'missing', messages: [], drafts: [], proposals: [] }
  const { master } = api({ epoch: 0, resources: [] }); master.mockResolvedValue(view)
  const wrapper = mount(MasterChat, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('No script has been saved')
  await wrapper.get('textarea').setValue('An unsent correction')
  await wrapper.findAll('button').find(button => button.text() === 'Continue setup')!.trigger('click'); await flushPromises()
  expect(master).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'send', podId, text: expect.stringContaining('do not run the script') }))
  expect(wrapper.get('textarea').element.value).toBe('An unsent correction'); wrapper.unmount()
})
