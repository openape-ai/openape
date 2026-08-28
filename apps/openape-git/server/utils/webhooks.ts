import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// Signed webhooks (plan M5). One shared secret per webhook carries both
// directions: the forge signs the delivery body, the consumer signs its
// commit-status POST and its archive GET with the same key. HMAC-SHA256 over
// bytes — no key distribution problem, no token expiry for an unattended
// consumer, and every consumer language has it in its standard library.

export const SIGNATURE_HEADER = 'x-ape-signature-256'
export const TIMESTAMP_HEADER = 'x-ape-timestamp'

/** Skew allowed on a signed GET, in seconds — replay window of a read. */
export const MAX_TIMESTAMP_SKEW_SEC = 300

export function newWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

export function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

export function verifySignature(payload: string, secret: string, signature: string | undefined): boolean {
  if (!signature) return false
  const expected = Buffer.from(sign(payload, secret))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * Signed-request payload for GETs, which have no body: identity of the
 * resource plus a timestamp, so a captured URL stops working.
 */
export function archivePayload(owner: string, name: string, sha: string, timestamp: string): string {
  return `${owner}/${name}\n${sha}\n${timestamp}`
}

export function isFreshTimestamp(timestamp: string | undefined, nowSec: number): boolean {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  return Math.abs(nowSec - ts) <= MAX_TIMESTAMP_SKEW_SEC
}

export interface PushEventPayload {
  event: 'push'
  repo: string
  ref: string
  before: string
  after: string
  commits: { sha: string, subject: string, author: string, email: string }[]
  pusher: { email: string, act: string, delegator?: string }
  deliveredAt: number
}

export interface DeliveryResult {
  statusCode: number | null
  error: string | null
  durationMs: number
}

/** POST one signed payload. Never throws: the caller logs the outcome. */
export async function deliver(url: string, secret: string, payload: PushEventPayload, deliveryId: string): Promise<DeliveryResult> {
  const body = JSON.stringify(payload)
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ape-event': payload.event,
        'x-ape-delivery': deliveryId,
        [SIGNATURE_HEADER]: sign(body, secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    return { statusCode: response.status, error: null, durationMs: Date.now() - started }
  }
  catch (err) {
    // ponytail: no retry queue — the delivery log shows the failure and a
    // re-push re-fires. Add retries when a consumer's downtime actually hurts.
    return { statusCode: null, error: (err as Error).message, durationMs: Date.now() - started }
  }
}
