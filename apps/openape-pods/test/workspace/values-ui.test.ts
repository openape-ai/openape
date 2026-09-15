import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodValues from '../../src/renderer/PodValues.vue'
import PodSettings from '../../src/renderer/PodSettings.vue'

it('keeps ordinary variable edits per pod and renders valid bracket references', async () => {
  const podId = crypto.randomUUID(); const resources = vi.fn().mockResolvedValue({ resources: [], variables: [{ name: 'mail-folder', value: 'Inbox', revision: 1 }], epoch: 0 })
  window.pods = { resources, master: async () => ({ proposals: [] }), scripts: async () => ({ source: null }) } as unknown as typeof window.pods
  const options = { props: { podId }, global: { stubs: { PodResources: true } } }
  let wrapper = mount(PodValues, options); await flushPromises()
  expect(wrapper.get('code').text()).toBe('context.variables["mail-folder"]')
  await wrapper.findAll('input')[0]!.setValue('topic'); await wrapper.findAll('input')[1]!.setValue('Unsaved topic')
  wrapper.unmount(); wrapper = mount(PodValues, options); await flushPromises()
  expect(wrapper.findAll('input')[1]!.element.value).toBe('Unsaved topic')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(resources).toHaveBeenCalledWith({ type: 'saveVariable', podId, name: 'topic', value: 'Unsaved topic', revision: 0 }); wrapper.unmount()
})
it('keeps unsaved settings across navigation without replacing the saved revision', async () => {
  const pod = { id: crypto.randomUUID(), name: 'Original', revision: 1, lifecycle: 'paused', activeScript: null }
  window.pods = { workspace: vi.fn().mockResolvedValue({ pods: [pod], organization: { revision: 1, groups: [] } }) } as unknown as typeof window.pods
  const options = { props: { selectedPodId: pod.id }, global: { stubs: { PodSchedule: true, PodValues: true } } }
  let wrapper = mount(PodSettings, options); await flushPromises(); await wrapper.get('input').setValue('Unsaved name'); wrapper.unmount()
  pod.revision = 2; wrapper = mount(PodSettings, options); await flushPromises()
  expect(wrapper.get('input').element.value).toBe('Unsaved name')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(window.pods.workspace).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', revision: 1, name: 'Unsaved name' })); wrapper.unmount()
})
it('keeps an unfinished local pod form while visiting an existing pod', async () => {
  const pod = { id: crypto.randomUUID(), name: 'Existing', revision: 1, lifecycle: 'paused', activeScript: null }
  window.pods = { workspace: vi.fn().mockResolvedValue({ pods: [pod], organization: { revision: 1, groups: [] } }) } as unknown as typeof window.pods
  const global = { stubs: { PodSchedule: true, PodValues: true } }
  let wrapper = mount(PodSettings, { global }); await flushPromises(); await wrapper.get('input').setValue('New idea'); wrapper.unmount()
  wrapper = mount(PodSettings, { global, props: { selectedPodId: pod.id } }); await flushPromises(); wrapper.unmount()
  wrapper = mount(PodSettings, { global }); await flushPromises()
  expect(wrapper.get('input').element.value).toBe('New idea'); wrapper.unmount()
})
it('recovers a stale settings form only after explicit discard confirmation', async () => {
  const pod = { id: crypto.randomUUID(), name: 'Current', revision: 1, lifecycle: 'paused', activeScript: null }
  const workspace = vi.fn().mockImplementation(async (command) => { if (command.type === 'update') throw new Error('Stale pod revision'); return { pods: [structuredClone(pod)], organization: { revision: 1, groups: [] } } })
  window.pods = { workspace } as unknown as typeof window.pods
  const wrapper = mount(PodSettings, { props: { selectedPodId: pod.id }, global: { stubs: { PodSchedule: true, PodValues: true } } }); await flushPromises()
  await wrapper.get('input').setValue('My edits'); pod.name = 'Updated elsewhere'; pod.revision = 2
  await wrapper.get('form').trigger('submit'); await flushPromises()
  const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
  await button('Load saved settings').trigger('click'); expect(wrapper.get('input').element.value).toBe('My edits')
  await button('Keep editing').trigger('click'); expect(wrapper.get('input').element.value).toBe('My edits')
  await button('Load saved settings').trigger('click'); await button('Discard and reload').trigger('click'); await flushPromises()
  expect(wrapper.get('input').element.value).toBe('Updated elsewhere'); expect(wrapper.find('[role="alert"]').exists()).toBe(false); wrapper.unmount()
})

it('marks empty variables and exposes required secrets without inventing their values', async () => {
  const podId = crypto.randomUUID()
  const resources = vi.fn().mockResolvedValue({ resources: [], variables: [{ name: 'destination', value: '', revision: 1 }], epoch: 0 })
  window.pods = { resources, master: async () => ({ proposals: [] }), scripts: vi.fn().mockResolvedValue({ source: { capabilities: ['credential.notification_token'] } }) } as unknown as typeof window.pods
  const wrapper = mount(PodValues, { props: { podId }, global: { stubs: { PodResources: true } } }); await flushPromises()
  expect(wrapper.get('.value-row').text()).toContain('Not set')
  expect(wrapper.getComponent({ name: 'PodResources' }).props('requiredAliases')).toEqual(['notification_token'])
  expect(resources).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})

it('includes pending chat secrets and excludes declined proposals', async () => {
  const podId = crypto.randomUUID()
  const master = vi.fn().mockResolvedValue({ proposals: [
    { podId, state: 'pending', body: { provider: 'credential', alias: 'chat_token' } },
    { podId, state: 'declined', body: { provider: 'credential', alias: 'declined_token' } },
  ] })
  window.pods = { master, resources: async () => ({ variables: [] }), scripts: async () => ({ source: null }) } as unknown as typeof window.pods
  const wrapper = mount(PodValues, { props: { podId }, global: { stubs: { PodResources: true } } }); await flushPromises()
  expect(wrapper.getComponent({ name: 'PodResources' }).props('requiredAliases')).toEqual(['chat_token'])
  expect(master).toHaveBeenCalledWith({ type: 'list', podId })
  wrapper.unmount()
})
