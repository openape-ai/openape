import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import SshPermissions from '../../src/renderer/SshPermissions.vue'

it('shows reviewed route and revision and emits explicit assignment and revocation', async () => {
  const resource = { id: 'fixture', podId: 'pod', revision: 4, kind: 'tool', state: 'ready', name: 'server.example', configuration: { type: 'sshInventory', hosts: [{ alias: 'jump.example', hostname: 'jump.example', user: 'owner', port: 22 }, { alias: 'server.example', hostname: '10.0.0.2', user: 'debian', port: 22 }] } }
  const wrapper = mount(SshPermissions, { props: { state: { epoch: 2, resources: [resource] } } as never })
  expect(wrapper.text()).toContain('owner@jump.example (jump.example:22) → debian@server.example (10.0.0.2:22)')
  expect(wrapper.text()).toContain('revision 4')
  await wrapper.get('input[name="ssh-alias"]').setValue('server.example')
  await wrapper.get('input[name="ssh-jumps"]').setValue('jump.example')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('assign')?.[0]).toEqual([{ alias: 'server.example', jumps: ['jump.example'], profile: 'linde-server-v1' }])
  await wrapper.get('.resource-row button').trigger('click')
  expect(wrapper.emitted('revoke')?.[0]).toEqual([resource])
  await wrapper.setProps({ readOnly: true })
  expect(wrapper.find('form').exists()).toBe(false)
})
