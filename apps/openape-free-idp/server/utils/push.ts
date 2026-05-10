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
 * Approver resolution:
 *   1. If the requester has an explicit `approver` row (the case for
 *      agents, set at enroll time), notify the approver.
 *   2. If the requester is a human and has no `approver` row, notify
 *      the requester themselves — humans approve their own grants in
 *      the IdP UI, so they need to know one's pending. This used to
 *      `return` early on the assumption that "humans don't need
 *      someone else to approve their own grants", but the right
 *      reading is: humans ARE their own approver.
 *   3. If the requester has no user row at all (shouldn't happen but
 *      defensively), skip silently.
 *
 * Skips silently when:
 *   - VAPID keys aren't configured (dev environments)
 *   - Requester has no user row
 *   - Resolved recipient has no push subscriptions
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
  if (!requester) return

  // Recipient = explicit approver if present, else the requester
  // themselves (human approving their own grant). Agents always have
  // an approver set at enroll-time; humans typically don't.
  const recipient = requester.approver ?? requester.email

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userEmail, recipient))
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
