// Wire the Resend mail notifier into the IdP's grant-pending-hook
// surface (#1059). Complements the push hook (08): headless agents
// (worker, hook, launchd) never see the approve URL ape-shell prints
// to stdout, and without a push subscription the owner would learn
// about a pending grant only by accident. Fires AFTER pre-approval
// hooks (YOLO, standing grants) — auto-approved grants don't mail.

import { countPendingForApprover, resolveApprover } from '../utils/approver'
import { sendPendingGrantEmail } from '../utils/email'
import { createGrantMailDebouncer, notifyApproverOfPendingGrantByMail } from '../utils/grant-mail'

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
