// Mail leg of the grant-pending fan-out (#1059). Complements push (08):
// headless agents (worker, hook, launchd) never see the approve URL
// ape-shell prints to stdout, and without a push subscription the owner
// would learn about a pending grant only by accident. The delivery plugin
// (11) calls it only for grants still pending after the quiet window.

import { countPendingForApprover, resolveApprover } from '../utils/approver'
import { sendPendingGrantEmail } from '../utils/email'
import { createGrantMailDebouncer, notifyApproverOfPendingGrantByMail } from '../utils/grant-mail'
import { defineGrantNotificationChannel } from '../utils/grant-notifications'

export default defineNitroPlugin(() => {
  const debouncer = createGrantMailDebouncer()

  defineGrantNotificationChannel(async (grant) => {
    // Mirror the push hook's VAPID check: unconfigured mail (dev) is a
    // silent no-op, not an error. Real send failures below DO throw and
    // are logged by the delivery plugin.
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
