import { createError, defineEventHandler, readBody } from 'h3'
import { useDb } from '~~/server/utils/db'
import { messages } from '~~/server/database/schema'
import { useTransport } from '~~/server/utils/transport'
import { updateQuota, enforceQuota } from '~~/server/utils/quota'

export default defineEventHandler(async (event) => {
  const mailbox = event.context.mailbox
  const body = await readBody<{
    to: string
    subject: string
    text?: string
    html?: string
  }>(event)

  if (!body?.to || !body?.subject) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: to, subject' })
  }

  if (!body.text && !body.html) {
    throw createError({ statusCode: 400, statusMessage: 'Either text or html body is required' })
  }

  const transport = useTransport()
  const result = await transport.send({
    from: mailbox.address,
    to: body.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
  })

  const textSize = Buffer.byteLength(body.text || '', 'utf8')
  const htmlSize = Buffer.byteLength(body.html || '', 'utf8')
  const sizeBytes = textSize + htmlSize

  const id = crypto.randomUUID()
  const db = useDb()

  await db.insert(messages).values({
    id,
    mailboxId: mailbox.id,
    direction: 'outbound',
    fromAddr: mailbox.address,
    toAddr: body.to,
    subject: body.subject,
    textBody: body.text || null,
    htmlBody: body.html || null,
    sizeBytes,
    resendEmailId: result.id,
    createdAt: new Date(),
  })

  await updateQuota(mailbox.id, sizeBytes)
  await enforceQuota(mailbox.id)

  return { id, resendEmailId: result.id }
})
