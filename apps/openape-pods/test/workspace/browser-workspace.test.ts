import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import BrowserWorkspace from '../../src/renderer/central/BrowserWorkspace.vue'
import { WorkspaceRequestError } from '../../src/renderer/central/client'
import { browserFixture } from './browser-fixture'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function click(text: string) { const button = wrapper!.findAll('button').find(item => item.isVisible() && item.text() === text); expect(button, text).toBeDefined(); await button!.trigger('click'); await flushPromises() }
async function open() {
  const fixture = await browserFixture()
  Reflect.deleteProperty(window, 'pods')
  wrapper = mount(BrowserWorkspace, { props: { client: fixture.client }, attachTo: document.body }); await flushPromises()
  return fixture
}
async function pod() { await wrapper!.get('[aria-label="Pods"]').trigger('click'); await flushPromises(); await wrapper!.get('.central-pod').trigger('click'); await flushPromises() }

it('uses the desktop shell and every Pod section without a native bridge', async () => {
  await open()
  expect(wrapper!.get('.workflow-inventory').text()).toContain('Morning review')
  expect(wrapper!.get('.account-status').text()).toContain('owner@example.invalid')
  await pod()
  for (const tab of ['Script', 'Variables and secrets', 'Permissions', 'Settings', 'History', 'Overview']) {
    await click(tab)
    expect(wrapper!.findAll('[role="alert"]').map(item => item.text()).join(' ')).toBe('')
  }
  await wrapper!.get('[aria-label="App settings"]').trigger('click'); await flushPromises()
  expect(wrapper!.get('.app-settings').text()).toContain('Manage these accounts on the desktop.')
  await click('Sign out')
  expect(wrapper!.emitted('logout')).toHaveLength(1)
})

it('preserves descriptions across tabs and guards sidebar navigation until discard', async () => {
  await open(); await pod()
  await wrapper!.get('#pod-description').setValue('Unsaved browser draft')
  await click('History'); await click('Overview')
  expect((wrapper!.get('#pod-description').element as HTMLTextAreaElement).value).toBe('Unsaved browser draft')
  await wrapper!.get('[aria-label="Workflows"]').trigger('click'); await flushPromises()
  expect(wrapper!.get('[aria-label="Unsaved changes"]').isVisible()).toBe(true)
  await click('Keep editing')
  expect((wrapper!.get('#pod-description').element as HTMLTextAreaElement).value).toBe('Unsaved browser draft')
  await wrapper!.get('[aria-label="Workflows"]').trigger('click'); await flushPromises(); await click('Discard changes')
  expect(wrapper!.get('.workflow-inventory').isVisible()).toBe(true)
})

it('saves through the owner-scoped command contract and retains edits after conflicts', async () => {
  const fixture = await open(); await pod()
  const command = vi.spyOn(fixture.client, 'command').mockRejectedValueOnce(new WorkspaceRequestError(409, 'Workspace changed; reload before saving'))
  await wrapper!.get('#pod-description').setValue('Keep this draft')
  await wrapper!.get('#pod-description').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
  expect(command).toHaveBeenCalledWith(fixture.host.id, fixture.host.revision, { channel: 'details', body: { type: 'describe', podId: fixture.podId, revision: 0, text: 'Keep this draft' } }, expect.any(String))
  expect((wrapper!.get('#pod-description').element as HTMLTextAreaElement).value).toBe('Keep this draft')
  expect(wrapper!.text()).toContain('Workspace changed; reload before saving')
})

it('returns an expired browser session to login without rendering private content', async () => {
  const fixture = await browserFixture()
  fixture.client.session = async () => { throw new WorkspaceRequestError(401, 'authentication_required') }
  wrapper = mount(BrowserWorkspace, { props: { client: fixture.client } }); await flushPromises()
  expect(wrapper.emitted('login')).toHaveLength(1)
  expect(wrapper.text()).not.toContain('Morning review')
})

it('retains an offline draft and stops rendering private content after session expiry', async () => {
  const fixture = await open(); await pod()
  await wrapper!.get('#pod-description').setValue('Offline draft')
  fixture.host.online = false; fixture.host.workspace.pods[0]!.online = false
  fixture.wake(); await flushPromises()
  expect((wrapper!.get('#pod-description').element as HTMLTextAreaElement).value).toBe('Offline draft')
  expect(wrapper!.get('.remote-editor').attributes('disabled')).toBeDefined()
  fixture.client.inventory = async () => { throw new WorkspaceRequestError(401, 'authentication_required') }
  fixture.wake(); await flushPromises()
  expect(wrapper!.emitted('login')).toHaveLength(1)
  expect(wrapper!.find('#pod-description').exists()).toBe(false)
})

it('keeps uncertain operations blocked and reconciles without repeating the command', async () => {
  const fixture = await open(); await pod()
  const command = vi.spyOn(fixture.client, 'command').mockRejectedValueOnce(new Error('Connection lost after submit'))
  await wrapper!.get('#pod-description').setValue('One submission only')
  await wrapper!.get('#pod-description').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
  expect(wrapper!.get('.remote-editor').attributes('disabled')).toBeDefined()
  const id = command.mock.calls[0]![3]
  fixture.client.operation = async () => ({ id, runtimeId: fixture.host.id, command: command.mock.calls[0]![2], state: 'applied', result: null, error: null, revision: 2 })
  await click('Check pending operation')
  expect(command).toHaveBeenCalledTimes(1)
  expect(wrapper!.get('.remote-editor').attributes('disabled')).toBeUndefined()
})

it('shows inventory failures on the workflow start page and retries visibly', async () => {
  const fixture = await browserFixture()
  vi.spyOn(fixture.client, 'inventory').mockRejectedValueOnce(new Error('Workspace unavailable'))
  wrapper = mount(BrowserWorkspace, { props: { client: fixture.client }, attachTo: document.body }); await flushPromises()
  expect(wrapper.findAll('[role="alert"]').some(item => item.isVisible() && item.text().includes('Workspace unavailable'))).toBe(true)
  await click('Retry')
  expect(wrapper.get('.workflow-inventory').text()).toContain('Morning review')
})

it('accepts an applied description receipt and clears the navigation guard', async () => {
  const fixture = await open(); await pod()
  vi.spyOn(fixture.client, 'command').mockImplementation(async (_runtime, _revision, command, id) => {
    fixture.view.details.description = { text: 'Saved browser description', revision: 1, state: 'ready', error: null, updatedAt: 1 }
    return { id, runtimeId: fixture.host.id, command, state: 'applied', result: structuredClone(fixture.view.details), error: null, revision: ++fixture.host.revision }
  })
  await wrapper!.get('#pod-description').setValue('Saved browser description')
  await wrapper!.get('#pod-description').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
  expect(wrapper!.findAll('[role="alert"]').map(item => item.text()).join(' ')).toBe('')
  await wrapper!.get('[aria-label="Workflows"]').trigger('click'); await flushPromises()
  expect(wrapper!.get('.workflow-inventory').isVisible()).toBe(true)
  expect(wrapper!.find('[aria-label="Unsaved changes"]').exists()).toBe(false)
})
