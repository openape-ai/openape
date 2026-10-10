// Web Push leg of the grant-pending fan-out. The delivery plugin (11) calls
// it only for grants that still await a human after the quiet window, so
// auto-approved and promptly decided grants don't push.

import { notifyApproverOfPendingGrant } from '../utils/push'
import { defineGrantNotificationChannel } from '../utils/grant-notifications'

export default defineNitroPlugin(() => {
  defineGrantNotificationChannel(async (grant, waiting) => {
    await notifyApproverOfPendingGrant(grant, waiting)
  })
})
