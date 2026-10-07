import webpush from 'web-push'
import { useRuntimeConfig } from 'nitropack/runtime'
import { ProtocolError } from '@openape/pods-protocol'
import { InboxPrototype } from './inbox-prototype'

let instance: InboxPrototype | undefined
export function inbox(): InboxPrototype {
  const config = useRuntimeConfig()
  if (!config.inboxPrototypeEnabled) throw new ProtocolError('inbox_disabled', 503)
  instance ??= new InboxPrototype(String(config.inboxPrototypeDatabase))
  return instance
}

export function vapidPublicKey(): string { return String(useRuntimeConfig().inboxVapidPublicKey) }

let sending = false
// Sends each claimed push once. Failures are recorded for the device log, never retried: M0 measures delivery.
export async function dispatchDuePushes(): Promise<void> {
  const config = useRuntimeConfig()
  if (!config.inboxPrototypeEnabled || sending) return
  const publicKey = String(config.inboxVapidPublicKey)
  const privateKey = String(config.inboxVapidPrivateKey)
  if (!publicKey || !privateKey) return
  sending = true
  try {
    const store = inbox()
    for (const { push, ownerKey, item } of store.claimDue()) {
      const url = `${String(config.relayOrigin)}/inbox/item/${item.id}?push=${push.id}`
      // Declarative Web Push (iOS 18.4+) shows this even if worker code fails; `mutable` still lets the worker record a receipt.
      const payload = JSON.stringify({ web_push: 8030, mutable: true, notification: { title: 'Pods', body: item.kind === 'decision' ? 'Eine Entscheidung wartet.' : 'Neue Mitteilung.', navigate: url, tag: push.id, data: { url, receipt: push.token } } })
      const results = await Promise.all(store.subscriptions(ownerKey).map(async (subscription) => {
        try {
          const response = await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { vapidDetails: { subject: String(config.relayOrigin), publicKey, privateKey }, TTL: 86400, urgency: 'high', timeout: 15000 })
          return { status: response.statusCode, error: null }
        }
        catch (error) {
          const status = (error as { statusCode?: number }).statusCode ?? null
          if (status === 404 || status === 410) store.forget(subscription.endpoint)
          return { status, error: error instanceof Error ? error.message : String(error) }
        }
      }))
      const failed = results.find(result => result.error)
      store.recordSend(push.id, results.length ? (failed ?? results[0]!).status : null, results.length ? failed?.error ?? null : 'no_subscription')
    }
  }
  finally { sending = false }
}
