import { relay } from '../utils/service'

export default defineNitroPlugin((nitro) => {
  const timer = setInterval(() => { if (useRuntimeConfig().relayEnabled) relay().purge() }, 15000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
