import { describe, expect, it, vi } from 'vitest'
import type { TelegramEnvelope } from '../src/telegram-api'
import { TelegramChatApi } from '../src/telegram-chat-api'

function transportReturning(...envelopes: TelegramEnvelope[]) {
  const calls: Array<{ method: string, params: Record<string, unknown> }> = []
  let i = 0
  const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    return envelopes[Math.min(i++, envelopes.length - 1)]!
  })
  return { call, calls }
}

const sent = (message_id: number, date = 1700): TelegramEnvelope => ({ ok: true, result: { message_id, date } })

describe('TelegramChatApi.postMessage', () => {
  it('sends a "…" placeholder for an empty body and encodes chatId|messageId into the id', async () => {
    const { call, calls } = transportReturning(sent(42))
    const api = new TelegramChatApi(call)

    const posted = await api.postMessage('12345', '', { streaming: true, replyTo: '7' })

    expect(calls[0]!.method).toBe('sendMessage')
    expect(calls[0]!.params).toMatchObject({ chat_id: 12345, text: '…' })
    // reply_parameters wires the agent's answer as a quote-reply to the user msg
    expect(calls[0]!.params.reply_parameters).toMatchObject({ message_id: 7 })
    expect(posted.id).toBe('12345|42')
  })

  it('sends the real text and a forum message_thread_id for a numeric thread', async () => {
    const { call, calls } = transportReturning(sent(99))
    const api = new TelegramChatApi(call)

    await api.postMessage('-100777', 'hello world', { threadId: '55' })

    expect(calls[0]!.params).toMatchObject({ chat_id: -100777, text: 'hello world', message_thread_id: 55 })
  })

  it('does NOT set message_thread_id for the synthetic "main" thread', async () => {
    const { call, calls } = transportReturning(sent(1))
    const api = new TelegramChatApi(call)

    await api.postMessage('5', 'hi', { threadId: 'main' })

    expect(calls[0]!.params).not.toHaveProperty('message_thread_id')
  })

  it('throws when Telegram reports failure', async () => {
    const { call } = transportReturning({ ok: false, description: 'chat not found', error_code: 400 })
    const api = new TelegramChatApi(call)
    await expect(api.postMessage('5', 'hi')).rejects.toThrow(/chat not found/)
  })
})

describe('TelegramChatApi.patchMessage', () => {
  it('skips intermediate (streaming) body patches — M0 edits only the final', async () => {
    const { call } = transportReturning(sent(1))
    const api = new TelegramChatApi(call)

    await api.patchMessage('5|10', { body: 'partial' }) // streaming undefined → intermediate
    await api.patchMessage('5|10', { streamingStatus: '🔧 tool' }) // status row → no-op on TG

    expect(call).not.toHaveBeenCalled()
  })

  it('applies the final edit via editMessageText with decoded chat/message id', async () => {
    const { call, calls } = transportReturning({ ok: true, result: true })
    const api = new TelegramChatApi(call)

    await api.patchMessage('-100777|88', { body: 'final answer', streaming: false })

    expect(calls[0]!.method).toBe('editMessageText')
    expect(calls[0]!.params).toMatchObject({ chat_id: -100777, message_id: 88, text: 'final answer' })
  })

  it('swallows Telegram "message is not modified"', async () => {
    const { call } = transportReturning({ ok: false, description: 'Bad Request: message is not modified', error_code: 400 })
    const api = new TelegramChatApi(call)
    await expect(api.patchMessage('5|10', { body: '…', streaming: false })).resolves.toBeUndefined()
    expect(call).toHaveBeenCalledOnce()
  })

  it('throws on a real edit failure', async () => {
    const { call } = transportReturning({ ok: false, description: 'message to edit not found', error_code: 400 })
    const api = new TelegramChatApi(call)
    await expect(api.patchMessage('5|10', { body: 'x', streaming: false })).rejects.toThrow(/not found/)
  })
})
