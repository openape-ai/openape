import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import SoftwareUpdates from '../../src/renderer/SoftwareUpdates.vue'
import type { UpdateCommand, UpdateView } from '../../src/contracts/updates'

it('shows discovered versions and errors and requests installation only when clicked', async () => {
  const view: UpdateView = { state: 'idle', currentVersion: '0.1.2', version: null, progress: 0, error: null, backup: null }
  const updates = vi.fn(async ({ type }: UpdateCommand) => {
    if (type === 'check') { view.state = 'available'; view.version = '0.2.0' }
    if (type === 'install') { view.state = 'error'; view.error = 'Disk full' }
    return { ...view }
  })
  window.pods = { updates } as unknown as typeof window.pods
  const wrapper = mount(SoftwareUpdates)
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('Current version: 0.1.2')
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('New version: 0.2.0')
    expect(updates).not.toHaveBeenCalledWith({ type: 'install' })
    await wrapper.findAll('button').find(button => button.text() === 'Restart and install')!.trigger('click'); await flushPromises()
    expect(updates).toHaveBeenCalledWith({ type: 'install' })
    expect(wrapper.get('[role="alert"]').text()).toContain('Disk full')
  }
  finally { wrapper.unmount() }
})
