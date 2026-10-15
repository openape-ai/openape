import { app, shell, utilityProcess } from 'electron'
import { join } from 'node:path'
import { RuntimeWorker } from './runtime-worker'
import { createMacOSCredentialCache } from './connections/macos'
import type { WorkerStatus } from '../contracts/ipc'

export { grantPodName } from './runtime-worker'

export class FixtureWorker extends RuntimeWorker {
  constructor(publish: (status: WorkerStatus) => void) {
    super(publish, {
      apesCli: app.isPackaged ? join(process.resourcesPath, 'apes/ape-shell.mjs') : join(__dirname, '../vendor/apes/ape-shell.mjs'),
      credentials: createMacOSCredentialCache,
      openExternal: url => shell.openExternal(url),
      fork: (entry, options) => utilityProcess.fork(entry, [], options),
    })
  }
}
