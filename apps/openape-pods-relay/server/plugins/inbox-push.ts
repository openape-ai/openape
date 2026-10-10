import { inboxStore } from '../utils/inbox-service'
import { dispatchPushes } from '../utils/inbox-push'

// Push is only an alert: the item is in the inbox before its push is due. `inboxPushEnabled=false` stops
// dispatch alone; queued pushes then expire with the regular retention.
export default defineNitroPlugin((nitro) => {
  let running = false
  const timer = setInterval(async () => {
    const config = useRuntimeConfig()
    const publicKey = String(config.inboxVapidPublicKey)
    const privateKey = String(config.inboxVapidPrivateKey)
    if (running || !config.inboxEnabled || !config.inboxPushEnabled || !publicKey || !privateKey) return
    running = true
    try { await dispatchPushes(inboxStore(), { origin: String(config.relayOrigin), publicKey, privateKey }) }
    catch (error) { console.error('inbox push dispatch failed', error) }
    finally { running = false }
  }, 5000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
