import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodNavigation from '../../src/renderer/PodNavigation.vue'
import type { StoredPod } from '../../src/contracts/control'

const pod: StoredPod = { id: '00000000-0000-4000-8000-000000000001', name: 'Orders', revision: 1, lifecycle: 'paused', activeScript: null }
const group = { id: '00000000-0000-4000-8000-000000000002', name: '<script>Work</script>', collapsed: false, podIds: [pod.id] }
const props = { pods: [pod], podId: pod.id, organization: { revision: 3, groups: [group] }, available: true, highlight: true }
it('shows grouped pods as literal labels, selects pods, collapses groups and moves using the picker', async () => {
  const workspace = vi.fn().mockResolvedValue({ pods: [pod], organization: { revision: 4, groups: [] } }); window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, workspace } as unknown as typeof window.pods
  const wrapper = mount(PodNavigation, { props }); expect(wrapper.get('select').attributes('aria-label')).toBe('Group for Orders'); expect(wrapper.find('script').exists()).toBe(false); expect(wrapper.text()).toContain('<script>Work</script>')
  await wrapper.get('.pod-button').trigger('click'); expect(wrapper.emitted('select')).toEqual([[pod.id]])
  await wrapper.get('.group-toggle').trigger('click'); await flushPromises(); expect(workspace).toHaveBeenLastCalledWith({ type: 'organize', revision: 3, action: 'collapse', id: group.id, collapsed: true })
  await wrapper.get('select').setValue(''); await flushPromises(); expect(workspace).toHaveBeenLastCalledWith({ type: 'organize', revision: 3, action: 'move', podId: pod.id, groupId: null })
  await wrapper.setProps({ organization: { revision: 4, groups: [{ ...group, collapsed: true }] } }); expect(wrapper.get('button.group-toggle').attributes('aria-expanded')).toBe('false')
  wrapper.unmount()
})
it('retains entered text on error, creates groups and confirms removal without deleting a pod', async () => {
  const workspace = vi.fn().mockRejectedValueOnce(new Error('Groups changed. Refresh and try again.')).mockResolvedValue({ pods: [pod], organization: { revision: 4, groups: [] } }); window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, workspace } as unknown as typeof window.pods
  const wrapper = mount(PodNavigation, { props })
  await wrapper.get('[aria-label="New group"]').trigger('click'); await wrapper.get('input').setValue('Personal'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Groups changed'); expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Personal')
  await wrapper.get('form').trigger('submit'); await flushPromises(); expect(wrapper.find('form').exists()).toBe(false)
  await wrapper.get('.group-edit').trigger('click'); await wrapper.findAll('button').find(button => button.text() === 'Remove group')!.trigger('click'); expect(workspace).toHaveBeenCalledTimes(2)
  await wrapper.findAll('button').find(button => button.text() === 'Confirm removal')!.trigger('click'); await flushPromises(); expect(workspace).toHaveBeenLastCalledWith({ type: 'organize', revision: 3, action: 'remove', id: group.id })
  wrapper.unmount()
})
it('disables mutation controls while the worker is unavailable', () => {
  const wrapper = mount(PodNavigation, { props: { ...props, available: false } })
  expect(wrapper.get('select').attributes('disabled')).toBeDefined(); expect(wrapper.get('[aria-label="New group"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.pod-button').attributes('draggable')).toBe('false'); wrapper.unmount()
})
it('keeps the revision of an open form when polling receives a concurrent rename', async () => {
  const workspace = vi.fn().mockRejectedValueOnce(new Error('Groups changed. Refresh and try again.')).mockResolvedValue({ pods: [pod], organization: { revision: 5, groups: [{ ...group, name: 'Mine' }] } }); window.pods = { chats: async () => ({ conversations: [], activeConversationId: null }), workflows: async () => ({ workflows: [], runs: [] }), packages: async () => { throw new Error('No package search fixture configured') }, programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, workspace } as unknown as typeof window.pods
  const wrapper = mount(PodNavigation, { props }); await wrapper.get('.group-edit').trigger('click'); await wrapper.get('input').setValue('Mine')
  await wrapper.setProps({ organization: { revision: 4, groups: [{ ...group, name: 'Concurrent edit' }] } })
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(workspace).toHaveBeenLastCalledWith({ type: 'organize', revision: 3, action: 'rename', id: group.id, name: 'Mine' })
  expect(wrapper.get('[role="alert"]').text()).toContain('Groups changed'); expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Mine')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(workspace).toHaveBeenLastCalledWith({ type: 'organize', revision: 4, action: 'rename', id: group.id, name: 'Mine' }); wrapper.unmount()
})
