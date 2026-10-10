import webpush from 'web-push'
import type { InboxItem, InboxSubscription } from '../../shared/inbox-types'
import type { InboxStore } from './inbox-store'

export interface PushConfig { origin: string, publicKey: string, privateKey: string }
export type PushSend = (subscription: InboxSubscription, payload: string) => Promise<{ statusCode: number }>

// Push service errors other than "gone" are retried after these delays; the item itself is already in the inbox.
const retryDelaysMs = [30_000, 120_000, 600_000, 3_600_000]

// Declarative Web Push (iOS 18.4+) displays this even if the service worker fails; `mutable` lets the worker
// refresh the badge from the server. The item title is shown; the push service only relays the encrypted payload.
export function pushPayload(origin: string, item: InboxItem, badge: number): string {
  const navigate = `${origin}/inbox/item/${item.id}`
  const title = item.kind === 'decision' ? 'Entscheidung wartet' : (item.pod?.name ?? 'Pods')
  return JSON.stringify({ web_push: 8030, mutable: true, notification: { title, body: item.title.slice(0, 180), navigate, tag: item.id, app_badge: String(badge) } })
}

export function webPushSend(config: PushConfig): PushSend {
  return (subscription, payload) => webpush.sendNotification(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    payload,
    { vapidDetails: { subject: config.origin, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 86400, urgency: 'high', timeout: 15000 },
  )
}

const accepted = (status: number) => status >= 200 && status < 300
const gone = (status: number) => status === 404 || status === 410

// Sends every due push to all subscriptions of its account. "sent" means a push service accepted it,
// not that the phone displayed it. Expired subscriptions are removed; other failures retry with backoff.
export async function dispatchPushes(store: InboxStore, config: PushConfig, send: PushSend = webPushSend(config)): Promise<void> {
  for (const entry of store.claimOutbox()) {
    const content = store.pushContent(entry)
    if (!content) { store.settleOutbox(entry.id, { state: 'failed', result: 'item_gone' }); continue }
    const subscriptions = store.subscriptions(entry.owner)
    if (!subscriptions.length) { store.settleOutbox(entry.id, { state: 'failed', result: 'no_subscription' }); continue }
    const payload = pushPayload(config.origin, content.item, content.badge)
    const statuses = await Promise.all(subscriptions.map(async (subscription) => {
      try { return (await send(subscription, payload)).statusCode }
      catch (error) {
        const status = (error as { statusCode?: number }).statusCode ?? 0
        if (gone(status)) store.forgetEndpoint(subscription.endpoint)
        return status
      }
    }))
    const result = statuses.join(',')
    const delay = retryDelaysMs[entry.attempts]
    if (statuses.some(accepted)) store.settleOutbox(entry.id, { state: 'sent', result })
    else if (statuses.every(gone) || delay === undefined) store.settleOutbox(entry.id, { state: 'failed', result })
    else store.settleOutbox(entry.id, { state: 'pending', next: store.now() + delay, result })
  }
}
