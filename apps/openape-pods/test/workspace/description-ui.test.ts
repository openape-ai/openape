import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodDescription from '../../src/renderer/PodDescription.vue'

it('retains the last successful description with a visible retry after a model failure', async () => {
  const podId = crypto.randomUUID()
  const description = { text: 'Existing summary', state: 'failed', error: 'Description generation failed', revision: 1, updatedAt: 1 }
  const master = vi.fn().mockResolvedValue({ description })
  window.pods = { master } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId } }); await flushPromises()
  expect(wrapper.text()).toContain('Existing summary'); expect(wrapper.text()).toContain('Description not updated')
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('button.secondary').trigger('click'); expect(master).toHaveBeenLastCalledWith({ type: 'summarize', podId })
  await wrapper.get('button.text-button').trigger('click'); expect(wrapper.emitted('change')).toHaveLength(1)
  wrapper.unmount()
})

it('allows a ready description to be refreshed without sending a chat message', async () => {
  const podId = crypto.randomUUID(); const master = vi.fn().mockResolvedValue({ description: { text: 'Existing summary', state: 'ready', error: null, revision: 1, updatedAt: 1 } })
  window.pods = { master } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId } }); await flushPromises()
  try { await wrapper.findAll('button').find(button => button.text() === 'Refresh description')!.trigger('click'); expect(master).toHaveBeenLastCalledWith({ type: 'summarize', podId }) }
  finally { wrapper.unmount() }
})

it('asks for a conversation when no description exists instead of presenting a second instruction', async () => {
  window.pods = { master: vi.fn().mockResolvedValue({}) } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  expect(wrapper.text()).toContain('Describe this pod in Chat')
  expect(wrapper.text()).toContain('No conversation description yet')
  wrapper.unmount()
})
