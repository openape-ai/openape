// Delivery of the grant-pending fan-out (#1455). The module fires its
// grant-pending hook once a grant stays pending after every pre-approval
// check; this plugin decides WHEN the channels (push 08, mail 09, Telegram 10)
// hear about it: only after the quiet window and only if the grant still
// awaits the owner then.

import type { OpenApeGrant } from '@openape/core'
import { useDb } from '../database/drizzle'
import { resolveApprover } from '../utils/approver'
import { isFollowUpBatchMember } from '../utils/grant-approval-link'
import { GRANT_NOTIFICATION_SWEEP_MS, createGrantNotificationQueue, notifyPendingGrants } from '../utils/grant-notifications'

export default defineNitroPlugin((nitroApp) => {
  const delayMs = Number(useRuntimeConfig().grantNotificationDelaySeconds) * 1000
  const grantStore = () => useGrantStores().grantStore
  const notify = (grants: OpenApeGrant[]) => notifyPendingGrants(grants, {
    approverOf: grant => resolveApprover(grant.request.requester, grant),
  })

  // A window of 0 keeps the immediate fan-out. E2E runs without the
  // database (02 returns early), so it keeps it too.
  if (!(delayMs > 0) || process.env.OPENAPE_E2E === '1') {
    defineGrantPendingHook(async (grant) => {
      // One notification announces a batch; every member after the first stays quiet.
      if (await isFollowUpBatchMember(grant, grantStore())) return
      await notify([grant])
    })
    return
  }

  const queue = createGrantNotificationQueue(useDb(), delayMs)
  defineGrantPendingHook(async (grant) => {
    if (await isFollowUpBatchMember(grant, grantStore())) return
    await queue.enqueue(grant)
  })

  let sweeping = false
  async function sweep(): Promise<void> {
    if (sweeping) return
    sweeping = true
    try { await notify(await queue.sweep(id => grantStore().findById(id))) }
    finally { sweeping = false }
  }
  const timer = setInterval(() => {
    sweep().catch(err => console.error('[grant-notifications] sweep failed:', err))
  }, Math.min(delayMs, GRANT_NOTIFICATION_SWEEP_MS))
  timer.unref()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
