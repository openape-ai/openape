import { hub } from '../utils/runtime'

export default defineNitroPlugin((nitro) => {
  const timer = setInterval(() => { if (useRuntimeConfig().relayEnabled) hub().tick() }, 15000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
