import type { InferSelectModel } from 'drizzle-orm'
import type { CheckResult } from './check-core'
import { eq, sql } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { ulid } from 'ulid'
import { useDb } from '../database/drizzle'
import { checks, monitors } from '../database/schema'
import { checkHeartbeat, checkOnce } from './check-core'
import { sendMail } from './mail-resend'

type Monitor = InferSelectModel<typeof monitors>

/** Retained history rows per monitor (older ones are pruned after each check). */
const HISTORY_KEEP = 100

function alertMail(m: Monitor, result: CheckResult, publicUrl: string): { subject: string, text: string } {
  const base = (publicUrl || 'https://monitor.openape.ai').replace(/\/$/, '')
  const dashboard = `${base}/monitors`
  // A heartbeat monitor has no URL to name, and "not responding" would be
  // misleading: nothing was asked. It went quiet.
  const subject = m.kind === 'heartbeat' ? m.name : `${m.name} (${m.url})`
  if (result.up) {
    const detail = m.kind === 'heartbeat'
      ? 'Pings are arriving again.'
      : `Status: ${result.statusCode ?? '—'}, ${result.latencyMs ?? '—'}ms`
    return {
      subject: `✅ UP again: ${m.name}`,
      text: `${subject} is alive again.\n\n${detail}\n\n→ ${dashboard}`,
    }
  }
  return {
    subject: `🔴 DOWN: ${m.name}`,
    text: `${subject} ${m.kind === 'heartbeat' ? 'stopped reporting in' : 'is not responding'}.\n\n${result.error ?? `HTTP ${result.statusCode}`}\n\n→ ${dashboard}`,
  }
}

/**
 * Run one check for a monitor: probe, persist the result, prune old history,
 * and — only on an up↔down transition — email the owner. The transition guard
 * is what stops every failed poll from spamming: mail fires on the edge, not
 * the level.
 */
export async function runCheck(m: Monitor): Promise<CheckResult> {
  const nowSec = Math.floor(Date.now() / 1000)
  const result = m.kind === 'heartbeat'
    ? checkHeartbeat(m, nowSec)
    : await checkOnce(m.url)
  const status = result.up ? 'up' : 'down'
  const changed = m.lastStatus != null && m.lastStatus !== status

  const db = useDb()
  await db.insert(checks).values({
    id: ulid(),
    monitorId: m.id,
    ts: nowSec,
    up: result.up,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
  })

  await db.update(monitors).set({
    lastStatus: status,
    lastCode: result.statusCode,
    lastLatencyMs: result.latencyMs,
    lastError: result.error,
    lastCheckedAt: nowSec,
  }).where(eq(monitors.id, m.id))

  // Prune history beyond the newest HISTORY_KEEP rows for this monitor.
  await db.run(sql`DELETE FROM checks WHERE monitor_id = ${m.id} AND id NOT IN (
    SELECT id FROM checks WHERE monitor_id = ${m.id} ORDER BY ts DESC LIMIT ${HISTORY_KEEP}
  )`)

  if (changed) {
    const { publicUrl, resendApiKey } = useRuntimeConfig()
    if (resendApiKey) {
      const mail = alertMail(m, result, publicUrl as string)
      try {
        await sendMail({ to: m.ownerEmail, subject: mail.subject, text: mail.text })
      }
      catch (err) {
        console.error(`[monitor] alert mail failed for ${m.id}:`, err)
      }
    }
    else {
      console.warn(`[monitor] ${status.toUpperCase()} transition for ${m.name}, no RESEND key — mail skipped`)
    }
  }

  return result
}

/** Check every monitor whose interval has elapsed. Called by the ticker. */
export async function runDueChecks(): Promise<number> {
  const db = useDb()
  const nowSec = Math.floor(Date.now() / 1000)
  const due = await db.select().from(monitors).where(
    // never checked OR interval elapsed
    sql`(${monitors.lastCheckedAt} IS NULL OR ${monitors.lastCheckedAt} + ${monitors.intervalSec} <= ${nowSec})`,
  )
  for (const m of due) await runCheck(m)
  return due.length
}
