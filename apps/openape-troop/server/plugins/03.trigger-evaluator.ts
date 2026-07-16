import { eq } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { cockpitSchedules } from '../database/schema'
import { isDue } from '../utils/cockpit/schedule'
import { buildOrgSystemPrompt } from '../utils/cockpit/org-context'
import { enqueue } from '../utils/cockpit/queue'

// Proactive triggers. Every 15s, find due trigger rows and enqueue their `prompt`
// as an Operator task for the org. The always-on worker claims it like any
// cockpit task; its answer is saved to the chat and fires a Web-Push
// (saveChatMessage → pushToOwner; the SW suppresses it while a tab is focused, so
// a proactive briefing notifies while a live reply doesn't). Durable across
// restarts: no RAM state, the DB is the source of truth every tick.
const TICK_MS = 15_000

async function tick(): Promise<void> {
  const db = useDb()
  const now = Date.now()
  const rows = await db.select().from(cockpitSchedules).where(eq(cockpitSchedules.enabled, true))
  for (const s of rows) {
    if (!s.prompt.trim()) continue
    if (!isDue({ atHour: s.atHour, everyMinutes: s.everyMinutes, fireAt: s.fireAt, enabled: s.enabled, lastRunAt: s.lastRunAt }, now)) continue
    const systemPrompt = await buildOrgSystemPrompt(s.ownerEmail, s.orgId)
    if (systemPrompt == null) continue // org gone or not owned — skip quietly
    enqueue(s.orgId, systemPrompt, s.prompt, s.ownerEmail)
    // Stamp lastRunAt at enqueue time (fire-and-forget: dedup, not delivery
    // guarantee); a one-shot timer disables itself after firing.
    await db.update(cockpitSchedules)
      .set({ lastRunAt: now, enabled: s.fireAt == null })
      .where(eq(cockpitSchedules.id, s.id))
  }
}

export default defineNitroPlugin(() => {
  if (process.env.OPENAPE_E2E === '1') return
  let running = false // skip overlap if a tick ever runs long
  setInterval(() => {
    if (running) return
    running = true
    void tick()
      .catch(err => console.error('[trigger-evaluator]', err))
      .finally(() => { running = false })
  }, TICK_MS)
})
