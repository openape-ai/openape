import { acquireProfileLease } from './profile-lease'
import { join } from 'node:path'
import { runtimeParentPort } from './parent-port'
import { classifyStorageError, openStorage, setOpenedStore } from './storage/readiness'

/**
 * The worker opens storage before any runtime module loads (issue 1465). A failure is reported to the window as a
 * classified recovery case and the worker ends: nothing schedules, claims or acts without ready storage.
 */
const port = runtimeParentPort()
export const started: Promise<void> = (async () => {
  try {
    if (process.env.PODS_PROFILE_LEASE === '1') await acquireProfileLease(process.cwd(), join(__dirname, '../native/pods-profile-lock'))
    setOpenedStore(openStorage(process.cwd()))
  }
  catch (error) {
    const failure = classifyStorageError(error)
    console.error(`Storage is not ready (${failure.reason}): ${failure.message}`)
    port.postMessage({ storage: failure })
    setTimeout(() => process.exit(3), 250)
    return
  }
  await import('./runtime')
})()
