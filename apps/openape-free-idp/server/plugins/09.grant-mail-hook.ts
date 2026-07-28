// Wire the Resend mail notifier into the IdP's grant-pending-hook
// surface (#1059). Complements the push hook (08): headless agents
// (worker, hook, launchd) never see the approve URL ape-shell prints
// to stdout, and without a push subscription the owner would learn
// about a pending grant only by accident. Fires AFTER pre-approval
// hooks (YOLO, standing grants) — auto-approved grants don't mail.

import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { users } from '../database/schema'
import { sendPendingGrantEmail } from '../utils/email'
import { createGrantMailDebouncer, notifyApproverOfPendingGrantByMail } from '../utils/grant-mail'

// Same resolution as the push hook: explicit approver row if present
// (agents get one at enroll time), else the requester approves their
// own grants. No user row -> nobody to notify.
async function resolveApprover(requester: string): Promise<string | null> {
  const row = await useDb()
    .select()
    .from(users)
    .where(eq(users.email, requester))
    .get()
  if (!row) return null
  return row.approver ?? row.email
}

async function countPendingForApprover(approver: string): Promise<number> {
  const { grantStore } = useGrantStores()
  const pending = await grantStore.findPending()
  const approverByRequester = new Map<string, string | null>()
  let count = 0
  for (const grant of pending) {
    const requester = grant.request.requester
    if (!approverByRequester.has(requester)) {
      approverByRequester.set(requester, await resolveApprover(requester))
    }
    if (approverByRequester.get(requester) === approver) count++
  }
  return count
}

export default defineNitroPlugin(() => {
  const debouncer = createGrantMailDebouncer()

  defineGrantPendingHook(async (grant) => {
    // Mirror the push hook's VAPID check: unconfigured mail (dev) is a
    // silent no-op, not an error. Real send failures below DO throw and
    // are logged by the hook runner.
    if (!useRuntimeConfig().resendApiKey) return

    await notifyApproverOfPendingGrantByMail(grant, {
      issuer: useRuntimeConfig().openapeIdp.issuer as string,
      debouncer,
      resolveApprover,
      countPendingForApprover,
      sendMail: sendPendingGrantEmail,
    })
  })
})
