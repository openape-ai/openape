import { listOwners, sendBriefingTo } from '../utils/briefing'

/**
 * 06:30-Cron (Europe/Vienna via container TZ): one briefing mail per owner
 * from the last 24 h of KPIs. Failures per owner are logged, never fatal —
 * one broken address must not kill the other briefings.
 */
export default defineTask({
  meta: { name: 'morning-mail', description: 'Send every owner their morning briefing' },
  async run() {
    const owners = await listOwners()
    const sent: string[] = []
    for (const owner of owners) {
      try {
        const { subject } = await sendBriefingTo(owner)
        console.info(`[morning-mail] sent to ${owner}: ${subject}`)
        sent.push(owner)
      }
      catch (err) {
        console.error(`[morning-mail] FAILED for ${owner}:`, err)
      }
    }
    return { result: { owners: owners.length, sent: sent.length } }
  },
})
