import { and, eq, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { tasks } from '../database/schema'
import { ResendError, sendMail } from '../utils/mail-resend'

const ONE_DAY_SECONDS = 24 * 3600

interface DueTask {
  id: string
  teamId: string
  title: string
  notes: string
  assigneeEmail: string | null
  ownerEmail: string
  remindAt: number | null
  reminderCount: number
  reminderMax: number
  contextUrl: string | null
  contextSummary: string | null
}

function escalationSubject(task: DueTask): string {
  if (task.reminderCount === 0) return `⏰ Wiedervorlage: ${task.title}`
  return `⏰⏰ Erinnerung #${task.reminderCount + 1}: ${task.title}`
}

function plaintextBody(task: DueTask, taskUrl: string): string {
  const lines = [
    'Du wolltest dir Folgendes wieder anschauen:',
    '',
    task.contextSummary || task.title,
    '',
    `→ Task öffnen: ${taskUrl}`,
  ]
  if (task.contextUrl) lines.push(`→ Original: ${task.contextUrl}`)
  if (task.notes) {
    lines.push('', 'Notizen:', task.notes)
  }
  lines.push(
    '',
    '---',
    `Erinnerung #${task.reminderCount + 1} von max ${task.reminderMax}.`,
    'Markiere den Task als done in der App, um die Eskalation zu beenden.',
  )
  return lines.join('\n')
}

function htmlBody(task: DueTask, taskUrl: string): string {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const summary = escape(task.contextSummary || task.title)
  const notes = task.notes ? `<p style="white-space:pre-wrap;color:#3f3f46">${escape(task.notes)}</p>` : ''
  const contextLink = task.contextUrl
    ? `<p><a href="${escape(task.contextUrl)}" style="color:#f97316">Original-Kontext öffnen</a></p>`
    : ''
  return `<!doctype html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px;margin:0 auto;padding:24px">
<p style="font-size:14px;color:#71717a">Du wolltest dir Folgendes wieder anschauen:</p>
<h2 style="margin:16px 0">${summary}</h2>
<p><a href="${escape(taskUrl)}" style="display:inline-block;background:#f97316;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Task öffnen</a></p>
${contextLink}
${notes}
<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0">
<p style="font-size:12px;color:#a1a1aa">Erinnerung #${task.reminderCount + 1} von max ${task.reminderMax}. Markiere den Task als <b>done</b> in der App, um die Eskalation zu beenden.</p>
</body></html>`
}

/**
 * Pick tasks ready for a reminder mail.
 *
 * Two cohorts:
 *   1. Initial: `remind_at <= now` AND `reminder_count = 0` AND active status
 *   2. Escalation: `last_reminder_at <= now - 24h` AND `0 < reminder_count < reminder_max` AND active
 *
 * Both cohorts share filter on:
 *   - `deleted_at IS NULL`
 *   - `status NOT IN ('done', 'archived')`
 *   - `assignee_email OR owner_email present` (we mail one of them)
 *
 * Status filter is in SQL. Recipient resolution happens in JS to keep the
 * SQL portable (drizzle's `or` chain on assignee/owner is awkward when one
 * is nullable).
 */
async function selectDue(now: number): Promise<DueTask[]> {
  const db = useDb()
  // Single query, both cohorts merged via OR. SQLite handles this fine.
  const rows = await db
    .select({
      id: tasks.id,
      teamId: tasks.teamId,
      title: tasks.title,
      notes: tasks.notes,
      assigneeEmail: tasks.assigneeEmail,
      ownerEmail: tasks.ownerEmail,
      remindAt: tasks.remindAt,
      reminderCount: tasks.reminderCount,
      reminderMax: tasks.reminderMax,
      contextUrl: tasks.contextUrl,
      contextSummary: tasks.contextSummary,
    })
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        ne(tasks.status, 'done'),
        ne(tasks.status, 'archived'),
        isNotNull(tasks.remindAt),
        or(
          // Initial cohort
          and(
            lte(tasks.remindAt, now),
            eq(tasks.reminderCount, 0),
          ),
          // Escalation cohort
          and(
            isNotNull(tasks.lastReminderAt),
            lte(tasks.lastReminderAt, now - ONE_DAY_SECONDS),
            sql`${tasks.reminderCount} > 0`,
            sql`${tasks.reminderCount} < ${tasks.reminderMax}`,
          ),
        ),
      ),
    )
    .all()

  return rows
}

export interface ReminderJobResult {
  picked: number
  sent: number
  failed: number
  skippedNoRecipient: number
}

/**
 * One pass of the reminder loop. Idempotent enough for the at-least-once
 * model — if a mail send succeeds but the DB update fails, the next tick
 * will resend (worst case: a single duplicate). We accept that vs the
 * alternative ("never resend, even if DB write was the only thing that
 * failed").
 */
export async function runReminderJob(now: number = Math.floor(Date.now() / 1000)): Promise<ReminderJobResult> {
  const config = useRuntimeConfig()
  const publicUrl = (config.publicUrl as string) || 'https://tasks.openape.ai'
  const apiKey = (config.resendApiKey as string) || ''

  // Hard-skip when not configured. Otherwise we'd `console.error` once per
  // task per tick, which spams logs the moment any task with `remind_at` set
  // goes past its trigger. The first missing-key warning lands in startup
  // logs (printed lazily on the first picked tick).
  if (!apiKey) {
    const due = await selectDue(now)
    if (due.length > 0) {
      console.warn(`[reminders] ${due.length} task(s) due but NUXT_RESEND_API_KEY not configured — skipping send. Set it in shared/.env to enable mails.`)
    }
    return { picked: due.length, sent: 0, failed: 0, skippedNoRecipient: 0 }
  }

  const due = await selectDue(now)
  let sent = 0
  let failed = 0
  let skippedNoRecipient = 0

  for (const task of due) {
    const recipient = task.assigneeEmail || task.ownerEmail
    if (!recipient) {
      skippedNoRecipient++
      continue
    }

    const taskUrl = `${publicUrl}/teams/${task.teamId}`

    try {
      await sendMail({
        to: recipient,
        subject: escalationSubject(task),
        text: plaintextBody(task, taskUrl),
        html: htmlBody(task, taskUrl),
      })

      const db = useDb()
      await db
        .update(tasks)
        .set({
          reminderCount: task.reminderCount + 1,
          lastReminderAt: now,
        })
        .where(eq(tasks.id, task.id))
        .run()
      sent++
    }
    catch (err) {
      failed++
      const reason = err instanceof ResendError
        ? `Resend ${err.status}: ${err.message}`
        : err instanceof Error ? err.message : String(err)
      console.error(`[reminders] failed task ${task.id} (recipient ${recipient}):`, reason)
    }
  }

  return { picked: due.length, sent, failed, skippedNoRecipient }
}
