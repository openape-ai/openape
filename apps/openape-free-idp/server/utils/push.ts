import type { OpenApeGrant } from '@openape/core'
import { eq } from 'drizzle-orm'
import webpush from 'web-push'
import { useDb } from '../database/drizzle'
import { pushSubscriptions, users } from '../database/schema'
import { summarizeRequest } from './summarize-grant'

let _configured = false

function ensureVapidConfigured(): boolean {
  if (_configured) return true
  const cfg = useRuntimeConfig()
  const publicKey = (cfg.public.vapidPublicKey as string) || ''
  const privateKey = (cfg.vapidPrivateKey as string) || ''
  const subject = (cfg.vapidSubject as string) || ''
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _configured = true
  return true
}

/**
 * Best-effort fan-out of a Web Push notification to whoever should
 * approve a freshly-created pending grant.
 *
 * Approver resolution: there's no `approver` column on `grants` today —
 * approver is derived from the requester's user row (`users.approver`).
 * Agents have an explicit approver set when they're enrolled; humans
 * (no `approver` row) get no notification, which is correct since
 * humans don't need someone else to approve their own grants.
 *
 * Skips silently when:
 *   - VAPID keys aren't configured (dev environments)
 *   - Requester has no user row, or no `approver` set
 *   - Approver has no push subscriptions
 *   - The grant is auto-approved (caller is responsible for that check;
 *     this helper assumes status='pending' and !auto_approval_kind)
 *
 * Endpoints that come back 404 or 410 are pruned — those are dead and
 * the browser/PWA is gone for good.
 */
export async function notifyApproverOfPendingGrant(grant: OpenApeGrant): Promise<void> {
  if (!ensureVapidConfigured()) return

  const db = useDb()
  const requester = await db
    .select()
    .from(users)
    .where(eq(users.email, grant.request.requester))
    .get()
  if (!requester?.approver) return

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userEmail, requester.approver))
  if (subs.length === 0) return

  const summary = summarizeRequest(grant.request)
  const payload = JSON.stringify({
    type: 'grant-pending',
    grant_id: grant.id,
    title: 'Approval needed',
    body: `${grant.request.requester}: ${summary}`,
    deep_link: `/grant-approval?grant_id=${encodeURIComponent(grant.id)}`,
  })

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
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, sub.endpoint))
          .catch(() => {})
        return
      }
      console.warn(`[push] approver send failed for ${sub.userEmail}: ${(err as Error)?.message ?? err}`)
    }
  }))
}
