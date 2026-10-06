import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodConsole from '../../src/renderer/PodConsole.vue'

const podId = '00000000-0000-4000-8000-000000000001'
const applicationId = '00000000-0000-4000-8000-000000000002'
const context = { workspace: '/pods/example/workspace', output: 'o365-cli login --account <account>', command: null, needsGrant: false, permission: null }
const command = { type: 'start', podId, applicationId, epoch: 1, argv: ['login', '--account', 'user@example.test'] }
const terminal = { sessionId: '00000000-0000-4000-8000-000000000003', podId, state: 'running', sequence: 0, output: '', exitCode: null, error: null }
it('opens ready for full commands, starts a foreground application and accepts another command after exit', async () => {
  const programs = vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, output: '', command }).mockResolvedValueOnce(terminal).mockResolvedValueOnce({ ...context, output: context.workspace })
  window.pods = { ...window.pods, programs }
  const wrapper = mount(PodConsole, { props: { podId, application: 'o365-cli' }, global: { stubs: { PodTerminal: true } } })
  await flushPromises()
  expect(wrapper.text()).toContain(context.workspace)
  await wrapper.get('input').setValue('o365-cli login --account user@example.test')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(programs).toHaveBeenNthCalledWith(2, { type: 'prepare', podId, line: 'o365-cli login --account user@example.test' })
  expect(programs).toHaveBeenNthCalledWith(3, command)
  expect(wrapper.find('input').exists()).toBe(false)
  wrapper.getComponent({ name: 'PodTerminal' }).vm.$emit('finished'); await flushPromises()
  await wrapper.get('input').setValue('pwd'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(programs).toHaveBeenCalledTimes(4)
  expect(wrapper.find('input').exists()).toBe(true)
  wrapper.unmount()
})
it('does not execute when the owner cancels the command permission dialog', async () => {
  const programs = vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, command, needsGrant: true, permission: 'login' }).mockResolvedValueOnce({ epoch: 1, resources: [] })
  window.pods = { ...window.pods, programs }
  const wrapper = mount(PodConsole, { props: { podId, application: 'o365-cli' }, global: { stubs: { PodTerminal: true } } })
  await flushPromises(); await wrapper.get('input').setValue('o365-cli login --account user@example.test')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(programs).toHaveBeenLastCalledWith({ ...command, type: 'grant' })
  expect(programs).toHaveBeenCalledTimes(3)
  expect(wrapper.find('pod-terminal-stub').exists()).toBe(false)
  wrapper.unmount()
})
it('starts the reviewed command at the new permission revision after approval', async () => {
  const resources = [{ id: applicationId, podId, state: 'ready', configuration: { grants: [{ permission: 'login' }] } }]
  const programs = vi.fn().mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, command: { ...command }, needsGrant: true, permission: 'login' }).mockResolvedValueOnce({ epoch: 2, resources }).mockResolvedValueOnce(terminal)
  window.pods = { ...window.pods, programs }
  const wrapper = mount(PodConsole, { props: { podId, application: 'o365-cli' }, global: { stubs: { PodTerminal: true } } })
  await flushPromises(); await wrapper.get('input').setValue('o365-cli login --account user@example.test')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(programs).toHaveBeenLastCalledWith({ ...command, epoch: 2 })
  expect(wrapper.emitted('updated')?.[0]).toEqual([{ epoch: 2, resources }])
  wrapper.unmount()
})
