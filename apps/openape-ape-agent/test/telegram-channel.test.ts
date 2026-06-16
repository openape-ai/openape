import { describe, expect, it, vi } from 'vitest'
import type { TelegramEnvelope } from '../src/telegram-api'
import { TelegramChannel } from '../src/telegram-channel'
import type { Message } from '../src/channel'
import type { ChatBackend } from '../src/troop-chat-api'

const OWNER_ID = 111
const STRANGER_ID = 222

function tgMessage(over: Record<string, unknown> = {}) {
  return { message_id: 1, from: { id: OWNER_ID }, chat: { id: 9000 }, date: 1700, text: 'hi', ...over }
}

/**
 * Drive the channel through one batch: getUpdates #1 = backlog-skip (empty),
 * #2 = `updates`, #3 onward parks on a never-resolving long-poll (as the real
 * API does). `start()` runs forever, so we don't await it — we wait until the
 * 3rd poll is reached, which means batch #2 has fully dispatched, then assert.
 */
async function runOnce(updates: Array<Record<string, unknown>>, ownerUserId = OWNER_ID) {
  const backend = { postMessage: vi.fn(async () => ({ id: 'x' })) } as unknown as ChatBackend
  const inbound: Array<{ msg: Message, backend: ChatBackend }> = []
  let pollCount = 0
  const never = new Promise<TelegramEnvelope>(() => {})
  // Resolves once the loop reaches the 3rd poll — by then batch #2 is fully dispatched.
  let onSettled: () => void = () => {}
  const settled = new Promise<void>((r) => { onSettled = r })
  const call = vi.fn(async (method: string, _params: Record<string, unknown>): Promise<TelegramEnvelope> => {
    if (method === 'getUpdates') {
      pollCount += 1
      if (pollCount === 1) return { ok: true, result: [] }
      if (pollCount === 2) return { ok: true, result: updates }
      onSettled()
      return never // park the loop on the open long-poll
    }
    return { ok: true, result: { message_id: 1 } } // sendMessage (greet/refuse)
  })
  const channel = new TelegramChannel({ call, ownerUserId, ownerEmail: 'owner@x.io', backend, log: () => {} })
  void channel.start((msg, b) => { inbound.push({ msg, backend: b }) }).catch(() => {})
  await settled
  return { inbound, backend, call }
}

describe('TelegramChannel owner-lock + mapping', () => {
  it('maps an owner text message into a normalized Message stamped with the owner email', async () => {
    const { inbound, backend } = await runOnce([{ update_id: 5, message: tgMessage({ text: 'status?' }) }])

    expect(inbound).toHaveLength(1)
    expect(inbound[0]!.msg).toMatchObject({
      roomId: '9000',
      threadId: 'main',
      senderEmail: 'owner@x.io',
      senderAct: 'human',
      body: 'status?',
    })
    expect(inbound[0]!.backend).toBe(backend)
  })

  it('maps a forum topic to its threadId', async () => {
    const { inbound } = await runOnce([{ update_id: 5, message: tgMessage({ message_thread_id: 77 }) }])
    expect(inbound[0]!.msg.threadId).toBe('77')
  })

  it('refuses a non-owner once and never forwards their message', async () => {
    const { inbound, backend } = await runOnce([
      { update_id: 5, message: tgMessage({ from: { id: STRANGER_ID }, text: 'let me in' }) },
    ])
    expect(inbound).toHaveLength(0)
    expect(backend.postMessage).not.toHaveBeenCalled() // refusal goes via the raw transport, not the backend
  })

  it('intercepts /start with a greeting and does not forward it to the agent', async () => {
    const { inbound } = await runOnce([{ update_id: 5, message: tgMessage({ text: '/start' }) }])
    expect(inbound).toHaveLength(0)
  })

  it('ignores non-text updates', async () => {
    const { inbound } = await runOnce([{ update_id: 5, message: { message_id: 2, from: { id: OWNER_ID }, chat: { id: 9000 } } }])
    expect(inbound).toHaveLength(0)
  })
})
