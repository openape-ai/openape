import { reconcileAllMirrors } from '../utils/mirror-reconcile'

export default defineNitroPlugin((nitro) => {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const scan = async () => {
    try { await reconcileAllMirrors() }
    catch (error) { console.error('[ape-git] mirror scan failed', error) }
    finally { if (!stopped) timer = setTimeout(scan, 300_000) }
  }
  // Database and hooks are ready. One timer, never overlapping scans.
  timer = setTimeout(scan, 5000)
  nitro.hooks.hook('close', () => { stopped = true; clearTimeout(timer) })
})
