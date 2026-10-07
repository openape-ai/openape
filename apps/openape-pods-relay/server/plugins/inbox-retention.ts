import { inboxStore } from '../utils/inbox-service'

export default defineNitroPlugin((nitro) => {
  const timer = setInterval(() => {
    if (!useRuntimeConfig().inboxEnabled) return
    try { inboxStore().retain() }
    catch (error) { console.error('inbox retention failed', error) }
  }, 3600000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
