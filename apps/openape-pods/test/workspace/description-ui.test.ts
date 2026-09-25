import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodDescription from '../../src/renderer/PodDescription.vue'

it('edits a description directly and sends its current revision without a chat', async () => {
  const podId = crypto.randomUUID()
  const details = vi.fn().mockResolvedValue({ description: { text: 'Existing summary', revision: 3 } })
  window.pods = { details } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId } }); await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('Existing summary')
  await wrapper.get('textarea').setValue('Updated purpose')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(details).toHaveBeenLastCalledWith({ type: 'describe', podId, text: 'Updated purpose', revision: 3 })
  wrapper.unmount()
})

it('retains unsaved text and exposes a conflicting save instead of overwriting it', async () => {
  const details = vi.fn().mockResolvedValueOnce({ description: null }).mockRejectedValue(new Error('Description changed; reload before saving'))
  window.pods = { details } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId: crypto.randomUUID() } }); await flushPromises()
  await wrapper.get('textarea').setValue('My text')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(wrapper.get('textarea').element.value).toBe('My text')
  expect(wrapper.get('[role="alert"]').text()).toContain('Description changed')
  wrapper.unmount()
})
