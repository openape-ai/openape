import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import JevPermissions from '../../src/renderer/JevPermissions.vue'
import type { ResourceState } from '../../src/contracts/resources'

it('requires a connected account and emits scoped assignments with a pinned model and attempt limit', async () => {
  const podId = '00000000-0000-4000-8000-000000000001'; const id = '00000000-0000-4000-8000-000000000002'
  const state: ResourceState = { epoch: 3, resources: [], jev: null }
  const wrapper = mount(JevPermissions, { props: { state, podId } })
  expect(wrapper.find('form').exists()).toBe(false)
  expect(wrapper.text()).toContain('Connect TypeSafe in desktop Accounts')
  await wrapper.setProps({ state: { ...state, jev: { id, state: 'ready', verifiedAt: 1 } } })
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('command')?.[0]).toEqual([{ type: 'assignJev', podId, epoch: 3, connectionId: id, model: 'jev-1.13.0', maxAttempts: 20 }])
  await wrapper.setProps({ state: { ...state, jev: { id, state: 'ready', verifiedAt: 1 }, resources: [{ id, podId, kind: 'tool', state: 'ready', name: 'TypeSafe / Jev', revision: 1, configuration: { type: 'jev', model: 'jev-1.14.0', maxAttempts: 5 } }] } })
  expect((wrapper.get('input[type="number"]').element as HTMLInputElement).value).toBe('5')
  expect((wrapper.findAll('input')[0].element as HTMLInputElement).value).toBe('jev-1.14.0')
  await wrapper.findAll('button').find(button => button.text() === 'Revoke access')!.trigger('click')
  expect(wrapper.emitted('command')?.at(-1)).toEqual([{ type: 'revoke', podId, id, revision: 1 }])
  wrapper.unmount()
})
