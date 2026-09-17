import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramPermissions from '../../src/renderer/ProgramPermissions.vue'
import type { ResourceState } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const state: ResourceState = { epoch: 2, resources: [{ id, podId, kind: 'tool', state: 'ready', name: 'Synthetic CLI', revision: 1, configuration: { type: 'program', executable: '/fixture/cli', grants: [{ permission: 'read', display: 'Read assigned data' }] } }] }
it('opens one external pod terminal without an embedded console or argument form', async () => {
  const programs = vi.fn(async command => command.type === 'launchStatus' ? null : state)
  window.pods = { ...window.pods, programs }
  const wrapper = mount(ProgramPermissions, { props: { podId, state }, global: { stubs: { PodConsole: true, ScriptAccess: true } } })
  expect(wrapper.text()).toContain('Terminal.app')
  expect(wrapper.text()).not.toContain('Signed in')
  await wrapper.get('.application-select').trigger('click')
  expect(wrapper.get('code').text()).toContain('application: "Synthetic CLI"')
  await wrapper.findAll('button').find(button => button.text() === 'Open Terminal.app')!.trigger('click')
  await flushPromises()
  expect(wrapper.find('pod-console-stub').exists()).toBe(false)
  expect(wrapper.find('input[aria-label^="Arguments"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Start in terminal')
  expect(programs).toHaveBeenCalledWith({ type: 'openShell', podId })
  wrapper.unmount()
})
it('submits the explicit HTTPS origin and methods without account or token fields', async () => {
  const resources = vi.fn().mockResolvedValue(state)
  window.pods = { ...window.pods, resources }
  const wrapper = mount(ProgramPermissions, { props: { podId, state } })
  await wrapper.get('input[type="url"]').setValue('https://api.example.com')
  await wrapper.get('input[value="GET"]').setValue(false)
  await wrapper.get('input[value="POST"]').setValue(true)
  await wrapper.get('.http-form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenCalledWith({ type: 'assignHttp', podId, epoch: 2, permission: { origin: 'https://api.example.com', methods: ['POST'] } })
  expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  wrapper.unmount()
})

it('keeps terminal launch progress and failures directly beside the launch control', async () => {
  let rejectLaunch!: (reason: Error) => void
  const programs = vi.fn(command => command.type === 'launchStatus' ? Promise.resolve(null) : new Promise<ResourceState>((_resolve, reject) => { rejectLaunch = reject }))
  window.pods = { ...window.pods, programs }
  const wrapper = mount(ProgramPermissions, { props: { podId, state }, global: { stubs: { ScriptAccess: true } } })
  const button = wrapper.findAll('button').find(item => item.text() === 'Open Terminal.app')!
  await button.trigger('click')
  expect(wrapper.get('[role="status"]').text()).toContain('Preparing pod terminal')
  expect(button.attributes('disabled')).toBeDefined()
  rejectLaunch(new Error('Pod identity connection failed (404)'))
  await flushPromises()
  const alert = wrapper.get('[role="alert"]')
  expect(alert.text()).toContain('Pod identity connection failed (404)')
  const firstApplication = wrapper.get('.application-card').element
  expect(alert.element.compareDocumentPosition(firstApplication) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(button.attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('starts the selected application with identifiers only and keeps replacement under its details', async () => {
  const programs = vi.fn(async command => command.type === 'launchStatus' ? null : { sessionId: id, podId, state: 'closed' as const, sequence: 1, output: '', exitCode: 0, error: null })
  window.pods = { ...window.pods, programs }
  const wrapper = mount(ProgramPermissions, { props: { podId, state }, global: { stubs: { ScriptAccess: true } } })
  await flushPromises()
  await wrapper.get('button[aria-label="Open Synthetic CLI"]').trigger('click'); await flushPromises()
  expect(programs).toHaveBeenCalledWith({ type: 'launch', podId, applicationId: id, epoch: 2 })
  expect(wrapper.find('select').exists()).toBe(false)
  await wrapper.get('.application-select').trigger('click')
  expect(wrapper.text()).toContain('Select installed replacement')
  wrapper.unmount()
})
