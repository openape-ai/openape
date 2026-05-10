// Wire the Web Push notifier into the IdP's grant-pending-hook
// surface. Fires AFTER pre-approval hooks (YOLO etc.) have had a
// chance to auto-approve — so auto-approved grants don't push, and
// pending grants that actually need a human do.

import { notifyApproverOfPendingGrant } from '../utils/push'

export default defineNitroPlugin(() => {
  defineGrantPendingHook(async (grant) => {
    if (grant.status !== 'pending' || grant.auto_approval_kind) return
    await notifyApproverOfPendingGrant(grant)
  })
})
