import { classifyStorageError, openStorage, setOpenedStore } from './storage/readiness'

/**
 * The worker opens storage before any runtime module loads (issue 1465). A failure is reported to the window as a
 * classified recovery case and the worker ends: nothing schedules, claims or acts without ready storage.
 */
const port = process.parentPort
if (!port) throw new Error('Pods worker requires its owning Electron process')
export const started: Promise<void> = (async () => {
  try { setOpenedStore(openStorage(process.cwd())) }
  catch (error) {
    const failure = classifyStorageError(error)
    console.error(`Storage is not ready (${failure.reason}): ${failure.message}`)
    port.postMessage({ storage: failure })
    setTimeout(() => process.exit(3), 250)
    return
  }
  await import('./runtime')
})()
