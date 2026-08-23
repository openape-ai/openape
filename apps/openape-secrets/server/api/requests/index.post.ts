import { defineEventHandler, getRequestURL, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { DEFAULT_TTL_SEC, MAX_TTL_SEC, secretRequests } from '../../database/schema'
import { callerEmail, loadConsumer } from '../../utils/access'
import { notifyOwnerOfRequest } from '../../utils/notify'
import { createProblemError } from '../../utils/problem'
import { toRequestView } from '../../utils/request-view'
import { sendTelegramMessage } from '../../utils/telegram'

interface Body {
  consumerId?: unknown
  fieldName?: unknown
  purpose?: unknown
  ttlSec?: unknown
}

/**
 * POST /api/requests — ask a human for one value.
 *
 * The request names WHAT is needed and WHY, never the value. It is addressed to
 * the consumer's owner, because that is who registered the machine the value is
 * for; the requester is recorded and shown, so the owner decides knowing who
 * benefits.
 */
export default defineEventHandler(async (event) => {
  const requester = await callerEmail(event)
  const body = await readBody<Body>(event)

  const consumerId = typeof body?.consumerId === 'string' ? body.consumerId.trim() : ''
  if (!consumerId) throw createProblemError({ status: 400, title: 'consumerId required' })

  const fieldName = typeof body?.fieldName === 'string' ? body.fieldName.trim().slice(0, 200) : ''
  if (!fieldName) throw createProblemError({ status: 400, title: 'fieldName required' })

  // 404 for a consumer this caller may not use: a distinct 403 would confirm
  // which machines exist on someone else's account.
  const consumer = await loadConsumer(consumerId, requester)

  const nowSec = Math.floor(Date.now() / 1000)
  const ttl = Number.isFinite(Number(body?.ttlSec))
    ? Math.min(MAX_TTL_SEC, Math.max(60, Math.floor(Number(body.ttlSec))))
    : DEFAULT_TTL_SEC

  const row = {
    id: ulid(),
    ownerEmail: consumer.ownerEmail,
    requester,
    consumerId: consumer.id,
    fieldName,
    purpose: typeof body?.purpose === 'string' ? body.purpose.trim().slice(0, 500) : '',
    status: 'requested' as const,
    expiresAt: nowSec + ttl,
    boxEpk: null,
    boxSalt: null,
    boxIv: null,
    boxCt: null,
    createdAt: nowSec,
    filledAt: null,
    fetchedAt: null,
  }
  await useDb().insert(secretRequests).values(row)

  // Tell the owner it is waiting. Fire-and-forget on purpose: a request that
  // exists but went unannounced is recoverable — the owner sees it in the list
  // — while failing the create because a chat was unreachable is not.
  const config = useRuntimeConfig()
  const { telegramBotToken, telegramChatId, telegramApprover, publicUrl } = config
  if (telegramBotToken && telegramChatId && telegramApprover) {
    void notifyOwnerOfRequest(row, consumer.name, {
      publicUrl: (publicUrl as string) || getRequestURL(event).origin,
      approver: telegramApprover as string,
      chatId: telegramChatId as string,
      send: (chatId, text) => sendTelegramMessage(telegramBotToken as string, chatId, text),
    }).catch(err => console.error('[notify] telegram', err))
  }

  setResponseStatus(event, 201)
  return toRequestView(row)
})
