import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramPermissions from '../../src/renderer/ProgramPermissions.vue'
import type { ResourceState } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const state: ResourceState = { epoch: 2, resources: [{ id, podId, kind: 'tool', state: 'ready', name: 'Synthetic CLI', revision: 1, configuration: { type: 'program', executable: '/fixture/cli', grants: [{ permission: 'read', display: 'Read assigned data' }] } }] }
it('opens the pod console directly without an argument form', async () => {
  const programs = vi.fn().mockResolvedValue(state)
  window.pods = { ...window.pods, programs }
  const wrapper = mount(ProgramPermissions, { props: { podId, state }, global: { stubs: { PodConsole: true, ScriptAccess: true } } })
  expect(wrapper.text()).toContain('Authentication is managed by the program itself.')
  expect(wrapper.text()).not.toContain('Signed in')
  expect(wrapper.get('code').text()).toContain('application: "Synthetic CLI"')
  await wrapper.findAll('button').find(button => button.text() === 'Open terminal')!.trigger('click')
  await flushPromises()
  expect(wrapper.find('pod-console-stub').exists()).toBe(true)
  expect(wrapper.find('input[aria-label^="Arguments"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Start in terminal')
  expect(programs).not.toHaveBeenCalled()
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
