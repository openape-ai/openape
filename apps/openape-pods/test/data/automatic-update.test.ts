// @vitest-environment node
import { expect, it, vi } from 'vitest'
import type { PodsRelease } from '@openape/pods-protocol'
import { AutomaticUpdate } from '../../src/main/automatic-update'

function fixture() {
  const release = { version: '0.2.0' } as PodsRelease
  const operations = { check: vi.fn(async () => release), download: vi.fn(async () => '/cache/update.zip'), verify: vi.fn(async () => {}), freeze: vi.fn(async () => {}), backup: vi.fn(async () => '/backups/profile'), resume: vi.fn(async () => {}), install: vi.fn() }
  return { operations, controller: new AutomaticUpdate('0.1.2', operations) }
}
it('checks automatically without downloading, backing up or restarting', async () => {
  const { operations, controller } = fixture()
  expect(await controller.check()).toMatchObject({ state: 'available', version: '0.2.0' })
  expect(operations.download).not.toHaveBeenCalled(); expect(operations.freeze).not.toHaveBeenCalled(); expect(operations.install).not.toHaveBeenCalled()
})
it('never hands an unverified archive to the native updater', async () => {
  const { operations, controller } = fixture(); await controller.check()
  operations.verify.mockRejectedValue(new Error('Wrong signing team'))
  expect(await controller.install()).toMatchObject({ state: 'error', error: 'Wrong signing team' })
  expect(operations.freeze).not.toHaveBeenCalled(); expect(operations.install).not.toHaveBeenCalled()
})
it('keeps a busy workspace running and never begins installation', async () => {
  const { operations, controller } = fixture(); await controller.check()
  operations.freeze.mockRejectedValue(new Error('Active run'))
  expect(await controller.install()).toMatchObject({ state: 'error', error: 'Active run' })
  expect(operations.backup).not.toHaveBeenCalled(); expect(operations.install).not.toHaveBeenCalled(); expect(operations.resume).not.toHaveBeenCalled()
})
it('releases the execution fence after a failed backup and allows retry', async () => {
  const { operations, controller } = fixture(); await controller.check()
  operations.backup.mockRejectedValueOnce(new Error('Disk full'))
  expect(await controller.install()).toMatchObject({ state: 'error', error: 'Disk full' })
  expect(operations.resume).toHaveBeenCalledOnce(); expect(operations.install).not.toHaveBeenCalled()
  expect(await controller.install()).toMatchObject({ state: 'installing', backup: '/backups/profile' })
  expect(operations.install).toHaveBeenCalledOnce(); expect(operations.resume).toHaveBeenCalledOnce()
  await controller.check(); await controller.install()
  expect(operations.install).toHaveBeenCalledOnce()
})
it('coalesces simultaneous checks and recovers from an offline error', async () => {
  const { operations, controller } = fixture()
  operations.check.mockRejectedValueOnce(new Error('Offline'))
  await Promise.all([controller.check(), controller.check()])
  expect(operations.check).toHaveBeenCalledOnce(); expect(controller.view.error).toBe('Offline')
  expect(await controller.check()).toMatchObject({ state: 'available', error: null })
})
it('leaves development builds disabled', async () => {
  const controller = new AutomaticUpdate('0.1.2', null)
  expect(await controller.check()).toMatchObject({ state: 'disabled' })
  expect(await controller.install()).toMatchObject({ state: 'disabled' })
})
it('requires restart after a native handoff error without resuming potentially staged work', async () => {
  const { operations, controller } = fixture(); await controller.check(); await controller.install()
  controller.fail(new Error('Native installation failed'))
  expect(await controller.check()).toMatchObject({ state: 'restart-required', error: 'Native installation failed' })
  await controller.install()
  expect(operations.install).toHaveBeenCalledOnce(); expect(operations.resume).not.toHaveBeenCalled()
})
