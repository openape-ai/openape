import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Minimal Resend client. We avoid the official `resend` npm package because
 * the only API call we need (`POST /emails`) is a single fetch — pulling in
 * a fully-fledged SDK plus its transitive deps for one line of HTTP would be
 * overkill for the build size goals of this service.
 *
 * Pricing/rate-limits/templates are managed in the Resend dashboard, not here.
 */

export interface SendMailParams {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export interface SendMailResult {
  id: string
}

export class ResendError extends Error {
  status: number
  body: unknown

  constructor(status: number, message: string, body: unknown) {
    super(`Resend ${status}: ${message}`)
    this.name = 'ResendError'
    this.status = status
    this.body = body
  }
}

/**
 * Send a transactional email via Resend. Throws ResendError on non-2xx so
 * the caller can decide retry semantics (we currently don't retry — the
 * reminder worker re-runs every 5 min so a transient outage self-heals).
 */
export async function sendMail(params: SendMailParams): Promise<SendMailResult> {
  const config = useRuntimeConfig()
  const apiKey = (config.resendApiKey as string) || ''
  const from = (config.reminderMailFrom as string) || 'reminders@openape.ai'

  if (!apiKey) {
    throw new ResendError(0, 'NUXT_RESEND_API_KEY not configured', { from, to: params.to })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  })

  let body: unknown = null
  try { body = await res.json() }
  catch { /* Resend returned non-JSON — keep null */ }

  if (!res.ok) {
    const message = (body && typeof body === 'object' && 'message' in body)
      ? String((body as { message: unknown }).message)
      : `HTTP ${res.status}`
    throw new ResendError(res.status, message, body)
  }

  const id = (body && typeof body === 'object' && 'id' in body)
    ? String((body as { id: unknown }).id)
    : 'unknown'
  return { id }
}
