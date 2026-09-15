import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PodDescription from '../../src/renderer/PodDescription.vue'

it('retains the last successful description with a visible retry after a model failure', async () => {
  const podId = crypto.randomUUID()
  const description = { text: 'Existing summary', state: 'failed', error: 'Description generation failed', revision: 1, updatedAt: 1 }
  const master = vi.fn().mockResolvedValue({ description })
  window.pods = { master } as unknown as typeof window.pods
  const wrapper = mount(PodDescription, { props: { podId, assignment: 'Execution assignment' } }); await flushPromises()
  expect(wrapper.text()).toContain('Existing summary'); expect(wrapper.text()).toContain('Description not updated')
  expect(wrapper.find('textarea').exists()).toBe(false)
  await wrapper.get('button.secondary').trigger('click'); expect(master).toHaveBeenLastCalledWith({ type: 'summarize', podId })
  await wrapper.get('button.text-button').trigger('click'); expect(wrapper.emitted('change')).toHaveLength(1)
  wrapper.unmount()
})
