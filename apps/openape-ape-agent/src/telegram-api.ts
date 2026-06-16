// Thin Telegram Bot API transport. One function `(method, params) => envelope`
// so both the outbound backend (TelegramChatApi) and the inbound poller
// (TelegramChannel) share one HTTP path and are trivially mockable in tests.

import { ofetch } from 'ofetch'

/** Telegram always replies with this envelope, 200 or not. */
export interface TelegramEnvelope<T = unknown> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

export type TelegramTransport = (method: string, params: Record<string, unknown>) => Promise<TelegramEnvelope>

/**
 * Real transport over the Bot API. `ignoreResponseError` so a 400/403 still
 * yields the `{ ok:false, description }` body (callers decide what to swallow,
 * e.g. "message is not modified"). The bot token is in the URL and must never
 * be logged.
 */
export function createTelegramTransport(botToken: string): TelegramTransport {
  const base = `https://api.telegram.org/bot${botToken}`
  return async (method, params) => {
    return await ofetch<TelegramEnvelope>(`${base}/${method}`, {
      method: 'POST',
      body: params,
      ignoreResponseError: true,
    })
  }
}

/** Telegram wants an integer chat_id for users/groups; pass numeric strings as numbers. */
export function chatIdParam(roomId: string): string | number {
  return /^-?\d+$/.test(roomId) ? Number(roomId) : roomId
}
