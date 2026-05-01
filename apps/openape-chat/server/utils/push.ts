import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'
import { useDb } from '../database/drizzle'
import { memberships, pushSubscriptions } from '../database/schema'

let _configured = false

function ensureConfigured(): boolean {
  if (_configured) return true
  const cfg = useRuntimeConfig()
  const publicKey = (cfg.public.vapidPublicKey as string) || ''
  const privateKey = (cfg.vapidPrivateKey as string) || ''
  const subject = (cfg.vapidSubject as string) || ''
  if (!publicKey || !privateKey) {
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _configured = true
  return true
}

export interface PushNotice {
  title: string
  body: string
  room_id?: string
  sender?: string
}

/**
 * Best-effort fan-out to web-push subscriptions. Skips entirely if VAPID
 * keys aren't configured (lets dev environments run without push) and
 * silently drops 404/410 endpoints (those are dead — Apple, Chrome,
 * Firefox all use those status codes for revoked subscriptions).
 *
 * `senderEmail` is excluded from the recipient set: you don't get a push
 * for your own message.
 */
export async function notifyRoomMembers(roomId: string, senderEmail: string, notice: PushNotice): Promise<void> {
  if (!ensureConfigured()) return

  const db = useDb()
  const recipients = await db
    .select({ userEmail: memberships.userEmail })
    .from(memberships)
    .where(eq(memberships.roomId, roomId))
  const recipientEmails = recipients
    .map(r => r.userEmail)
    .filter(e => e !== senderEmail)
  if (recipientEmails.length === 0) return

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userEmail, recipientEmails))
  if (subs.length === 0) return

  const payload = JSON.stringify({
    type: 'message',
    room_id: roomId,
    title: notice.title,
    body: notice.body,
    sender: notice.sender,
  })

  // Fire-and-forget per subscription. Dead endpoints get pruned so we
  // don't keep retrying them; legitimate transient failures (5xx) are
  // logged and forgotten — push services will retry the next message.
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    }
    catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).catch(() => {})
        return
      }
      console.warn(`[push] send failed for ${sub.userEmail}: ${(err as Error)?.message ?? err}`)
    }
  }))
}
