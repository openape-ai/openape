import { createError, defineEventHandler, getHeader, readRawBody } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { mailboxes, messages } from '~~/server/database/schema'
import { useTransport } from '~~/server/utils/transport'
import { updateQuota, enforceQuota } from '~~/server/utils/quota'

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  }
  catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const rawBody = await readRawBody(event, 'utf-8')

  if (!rawBody) {
    throw createError({ statusCode: 400, statusMessage: 'Empty body' })
  }

  // Always verify webhook signature — reject if secret not configured
  if (!config.webhookSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Webhook secret not configured' })
  }

  const signature = getHeader(event, 'resend-signature') || getHeader(event, 'x-webhook-signature') || ''
  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON' })
  }
  const eventType = body.type

  // Only handle email.received events
  if (eventType !== 'email.received') {
    return { ok: true, ignored: true }
  }

  const data = body.data
  const toAddresses: string[] = Array.isArray(data.to) ? data.to : [data.to]
  const fromAddr: string = data.from
  const emailId: string = data.email_id

  const db = useDb()

  for (const toAddr of toAddresses) {
    const addr = toAddr.toLowerCase().trim()

    // Find mailbox by address
    const mailbox = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, addr))
      .get()

    if (!mailbox) continue

    // Fetch full message from Resend
    const transport = useTransport()
    let fullMessage
    try {
      fullMessage = await transport.getInboundMessage(emailId)
    }
    catch {
      // If we can't retrieve the full message, use webhook data
      fullMessage = {
        from: fromAddr,
        to: addr,
        subject: data.subject || '',
        text: data.text,
        html: data.html,
      }
    }

    const textSize = Buffer.byteLength(fullMessage.text || '', 'utf8')
    const htmlSize = Buffer.byteLength(fullMessage.html || '', 'utf8')
    const sizeBytes = textSize + htmlSize

    const id = crypto.randomUUID()

    await db.insert(messages).values({
      id,
      mailboxId: mailbox.id,
      direction: 'inbound',
      fromAddr: fullMessage.from || fromAddr,
      toAddr: addr,
      subject: fullMessage.subject || data.subject || null,
      textBody: fullMessage.text || null,
      htmlBody: fullMessage.html || null,
      sizeBytes,
      resendEmailId: emailId,
      createdAt: new Date(),
    })

    await updateQuota(mailbox.id, sizeBytes)
    await enforceQuota(mailbox.id)
  }

  return { ok: true }
})
