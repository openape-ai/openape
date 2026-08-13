import { defineEventHandler } from 'h3'
import { sendBriefingTo } from '../../utils/briefing'
import { createProblemError } from '../../utils/problem'

/**
 * POST /api/morning-mail/send — send the CALLER their briefing right now.
 * Test-trigger and "resend me the mail" in one; recipient is always the
 * caller's own identity, nothing else is reachable from here.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  try {
    const { id, subject } = await sendBriefingTo(caller.email)
    return { ok: true, to: caller.email, subject, mailId: id }
  }
  catch (err) {
    throw createProblemError({ status: 502, title: `mail send failed: ${(err as Error).message}` })
  }
})
