import { createHash } from 'node:crypto'
import { isHttpEffect } from '../../contracts/http'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import type { EffectLedger } from '../recovery/effects'

export async function executeHttpEffect(ledger: EffectLedger, podId: string, runId: string, request: HttpRequest, send: () => Promise<HttpReply>): Promise<HttpReply> {
  if (!isHttpEffect(request.method)) return send()
  const key = request.key!
  const intent = ledger.begin(podId, runId, key, 'http.request', request)
  if (!intent.execute) return intent.result as HttpReply
  try {
    const reply = await send()
    if (reply.status >= 400) throw new Error('HTTP request returned an error response; review delivery before retrying')
    ledger.complete(podId, key, request.receipt === 'digest' ? digestReceipt(reply) : reply)
    return reply
  }
  catch (error) { ledger.markUnknown(podId, key); throw error }
}

// A digest receipt proves which reply was received without storing its content.
function digestReceipt(reply: HttpReply): HttpReply {
  const body = Buffer.from(reply.body, 'utf8')
  return { status: reply.status, headers: {}, body: '', receipt: { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length } }
}
