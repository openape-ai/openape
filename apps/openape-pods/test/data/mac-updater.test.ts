// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { MacUpdater } from 'electron-updater'

it('the pinned MacUpdater downloads without native staging until explicit installation', async () => {
  const native = Object.assign(new EventEmitter(), { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() })
  const updater = Object.setPrototypeOf(new EventEmitter(), MacUpdater.prototype) as MacUpdater
  Reflect.set(updater, 'nativeUpdater', native)
  Reflect.set(updater, '_logger', { info: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  updater.autoInstallOnAppQuit = false; updater.autoRunAppAfterInstall = true
  const ready = vi.fn(); updater.on('update-downloaded', ready)
  const downloaded = Reflect.get(updater, 'updateDownloaded') as (info: unknown, event: unknown) => Promise<unknown>
  try {
    await downloaded.call(updater, { info: { size: 24 }, url: new URL('https://pods.openape.ai/update.zip') }, { downloadedFile: '/not-read-until-native-install.zip', version: '0.2.0' })
    expect(ready).toHaveBeenCalledOnce()
    expect(native.checkForUpdates).not.toHaveBeenCalled()
    expect(native.quitAndInstall).not.toHaveBeenCalled()
    updater.quitAndInstall()
    expect(native.checkForUpdates).toHaveBeenCalledOnce()
    expect(native.quitAndInstall).not.toHaveBeenCalled()
    native.emit('update-downloaded')
    expect(native.quitAndInstall).toHaveBeenCalledOnce()
  }
  finally {
    const close = Reflect.get(updater, 'closeServerIfExists') as () => void
    close.call(updater)
  }
})
