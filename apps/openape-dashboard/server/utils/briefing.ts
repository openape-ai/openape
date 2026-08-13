import { desc, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { kpis } from '../database/schema'
import { latestPerKey } from './kpi-shape'
import { buildMorningMail } from './morning-mail'
import { sendMail } from './mail-resend'

const DAY_MS = 24 * 60 * 60 * 1000

/** Render and send one owner's briefing from the last 24 h of KPIs. */
export async function sendBriefingTo(owner: string): Promise<{ id: string, subject: string }> {
  const rows = await useDb()
    .select()
    .from(kpis)
    .where(eq(kpis.owner, owner))
    .orderBy(desc(kpis.createdAt))
    .limit(1000)
  const fresh = latestPerKey(rows.filter(r => r.createdAt >= Date.now() - DAY_MS))

  const dateLabel = new Date().toLocaleDateString('de-AT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Vienna',
  })
  const { publicUrl } = useRuntimeConfig()
  const mail = buildMorningMail(fresh, dateLabel, (publicUrl as string) || 'https://dashboard.openape.ai')
  const { id } = await sendMail({ to: owner, subject: mail.subject, text: mail.text, html: mail.html })
  return { id, subject: mail.subject }
}

/** All owners that ever pushed a KPI — each gets a briefing (also "nichts Neues"). */
export async function listOwners(): Promise<string[]> {
  const rows = await useDb().selectDistinct({ owner: kpis.owner }).from(kpis)
  return rows.map(r => r.owner)
}
