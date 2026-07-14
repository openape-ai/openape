import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../database/drizzle'
import { pushSubscriptions } from '../../database/schema'

let configured = false
function ensureVapid(): boolean {
  if (configured) return true
  const cfg = useRuntimeConfig()
  const pub = (cfg.public as { vapidPublicKey?: string }).vapidPublicKey
  const priv = cfg.vapidPrivateKey as string
  const subject = (cfg.vapidSubject as string) || 'mailto:patrick@hofmann.eco'
  if (!pub || !priv) return false // push not configured — silently no-op
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

// Send a Web-Push to every subscription of `owner`. Fire-and-forget from callers.
// Prunes dead subscriptions (404/410 = gone/expired) so the table self-cleans.
export async function pushToOwner(owner: string, payload: { title: string, body: string, url?: string }) {
  if (!ensureVapid()) return
  const db = useDb()
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerEmail, owner))
  if (subs.length === 0) return
  const data = JSON.stringify(payload)
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data)
    }
    catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404 || code === 410)
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint))
    }
  }))
}
