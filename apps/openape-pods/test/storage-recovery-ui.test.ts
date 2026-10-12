// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import StorageRecovery from '../src/renderer/StorageRecovery.vue'
import type { StorageRecoveryView } from '../src/contracts/storage'

const view = (valid: boolean): StorageRecoveryView => ({ failure: { reason: 'corrupt', message: 'Database integrity check failed', at: 1 }, diagnostics: { profile: '/profile', files: [{ name: 'control.sqlite', size: 4096, modifiedAt: 1 }], header: { sqlite: false, pageSize: null, schema: null }, freeBytes: 1024 ** 3 }, backups: valid ? [{ path: '/backups/OpenApe-Pods-2026-10-12-a', createdAt: '2026-10-12T10:00:00.000Z', schema: 48, bytes: 2048, files: 3, valid: true, problem: null, automatic: true }] : [], recoveryCopies: [], lastAutomaticBackup: { at: null, error: null } })
afterEach(() => { Reflect.deleteProperty(window, 'pods') })

it('explains the failure, keeps recovery controls usable and sends the exact commands', async () => {
  const storage = vi.fn(async () => view(true))
  Object.assign(window, { pods: { storage } })
  const wrapper = mount(StorageRecovery, { props: { failure: { reason: 'corrupt', message: 'Database integrity check failed', at: 1 } } })
  await flushPromises()
  expect(wrapper.text()).toContain('SQLite reported damaged data')
  expect(wrapper.text()).toContain('Automatic runs are stopped')
  expect(wrapper.find('[data-testid="storage-files"]').text()).toContain('control.sqlite')
  for (const [label, command] of [['Try again', { type: 'retry' }], ['Save a recovery copy', { type: 'preserve' }], ['Restore this backup', { type: 'restore', path: '/backups/OpenApe-Pods-2026-10-12-a' }], ['Choose another backup…', { type: 'restore', path: null }]] as const) {
    await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click'); await flushPromises()
    expect(storage).toHaveBeenLastCalledWith(command)
  }
})

it('states the data-loss consequence when no verified backup exists', async () => {
  Object.assign(window, { pods: { storage: vi.fn(async () => view(false)) } })
  const wrapper = mount(StorageRecovery, { props: { failure: null } })
  await flushPromises()
  expect(wrapper.find('[data-testid="no-backup"]').text()).toContain('data written since the damage may be lost')
})
