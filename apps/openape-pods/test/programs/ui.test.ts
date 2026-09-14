import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramPermissions from '../../src/renderer/ProgramPermissions.vue'
import type { ResourceState } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const state: ResourceState = { epoch: 2, resources: [{ id, podId, kind: 'tool', state: 'ready', name: 'Synthetic CLI', revision: 1, configuration: { type: 'program', executable: '/fixture/cli', grants: [{ permission: 'read', display: 'Read assigned data' }] } }] }
it('keeps program setup inside permissions, parses arguments and exposes a usable script reference', async () => {
  const programs = vi.fn().mockResolvedValue(state)
  window.pods = { ...window.pods, programs }
  const wrapper = mount(ProgramPermissions, { props: { podId, state }, global: { stubs: { PodTerminal: true } } })
  expect(wrapper.text()).toContain('Authentication is managed by the program itself.')
  expect(wrapper.text()).not.toContain('Signed in')
  expect(wrapper.get('code').text()).toContain(`applicationId: '${id}'`)
  await wrapper.get(`input[aria-label="Arguments for Synthetic CLI"]`).setValue('read --folder "Sent Items"')
  const buttons = () => wrapper.findAll('button')
  await buttons().find(button => button.text() === 'Allow command')!.trigger('click'); await flushPromises()
  expect(programs).toHaveBeenLastCalledWith({ type: 'grant', podId, applicationId: id, epoch: 2, argv: ['read', '--folder', 'Sent Items'] })
  await buttons().find(button => button.text() === 'Import existing setup')!.trigger('click'); await flushPromises()
  expect(programs).toHaveBeenLastCalledWith({ type: 'importState', podId, applicationId: id, epoch: 2 })
  await wrapper.get(`input[aria-label="Arguments for Synthetic CLI"]`).setValue('read; send')
  await buttons().find(button => button.text() === 'Open terminal')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('without shell operators')
  expect(programs).toHaveBeenCalledTimes(2)
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
