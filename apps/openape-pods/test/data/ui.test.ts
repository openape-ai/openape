import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import DataManagement from '../../src/renderer/DataManagement.vue'
import type { DataCommand } from '../../src/contracts/data'

it('shows storage limits, preserves recovery access after an unavailable worker and surfaces backup failures', async () => {
  const data = vi.fn(async (command: DataCommand) => {
    if (command.type === 'backup') throw new Error('Disk full; last backup retained')
    return { usedBytes: 1024 ** 3, freeBytes: 5 * 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 1, busy: false, error: null }
  })
  window.pods = { programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, data } as unknown as typeof window.pods
  const wrapper = mount(DataManagement); await flushPromises()
  expect(wrapper.text()).toContain('1.00 GiB'); expect(wrapper.text()).toContain('Pending local deletions')
  await wrapper.get('input').setValue(12); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(data).toHaveBeenLastCalledWith({ type: 'limit', bytes: 12 * 1024 ** 3 })
  await wrapper.findAll('button').find(item => item.text() === 'Export backup…')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('last backup retained'); wrapper.unmount()
  data.mockRejectedValue(new Error('Database needs a newer app'))
  const unavailable = mount(DataManagement); await flushPromises()
  expect(unavailable.findAll('button').find(item => item.text() === 'Restore backup and restart…')!.attributes('disabled')).toBeUndefined()
  unavailable.unmount()
})
it('disables maintenance while work is active', async () => {
  window.pods = { programs: async () => { throw new Error('No program fixture configured') }, language: async () => 'en' as const, scripts: async () => { throw new Error('No script fixture configured') }, data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: true, error: null }) } as unknown as typeof window.pods
  const wrapper = mount(DataManagement); await flushPromises()
  for (const text of ['Export backup…', 'Clean unused files', 'Verify update and back up…']) expect(wrapper.findAll('button').find(item => item.text() === text)!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
