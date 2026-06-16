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

interface RunOpts {
  ownerUserId?: number
  loadOwnerPin?: () => number | undefined
}

/**
 * Drive the channel through one batch: getUpdates #1 = backlog-skip (empty),
 * #2 = `updates`, #3 onward parks on a never-resolving long-poll (as the real
 * API does). `start()` runs forever, so we don't await it — we resolve once the
 * 3rd poll is reached, which means batch #2 has fully dispatched, then assert.
 */
async function runOnce(updates: Array<Record<string, unknown>>, opts: RunOpts = {}) {
  const backend = { postMessage: vi.fn(async () => ({ id: 'x' })) } as unknown as ChatBackend
  const saveOwnerPin = vi.fn()
  const inbound: Array<{ msg: Message, backend: ChatBackend }> = []
  let pollCount = 0
  const never = new Promise<TelegramEnvelope>(() => {})
  let onSettled: () => void = () => {}
  const settled = new Promise<void>((r) => { onSettled = r })
  const call = vi.fn(async (method: string, _params: Record<string, unknown>): Promise<TelegramEnvelope> => {
    if (method === 'getUpdates') {
      pollCount += 1
      if (pollCount === 1) return { ok: true, result: [] }
      if (pollCount === 2) return { ok: true, result: updates }
      onSettled()
      return never
    }
    return { ok: true, result: { message_id: 1 } } // sendMessage (greet/refuse)
  })
  const channel = new TelegramChannel({
    call,
    ownerUserId: opts.ownerUserId,
    loadOwnerPin: opts.loadOwnerPin,
    saveOwnerPin,
    ownerEmail: 'owner@x.io',
    backend,
    log: () => {},
  })
  void channel.start((msg, b) => { inbound.push({ msg, backend: b }) }).catch(() => {})
  await settled
  return { inbound, backend, call, saveOwnerPin }
}

describe('TelegramChannel — explicit owner lock', () => {
  it('maps an owner text message into a normalized Message stamped with the owner email', async () => {
    const { inbound, backend } = await runOnce([{ update_id: 5, message: tgMessage({ text: 'status?' }) }], { ownerUserId: OWNER_ID })

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
    const { inbound } = await runOnce([{ update_id: 5, message: tgMessage({ message_thread_id: 77 }) }], { ownerUserId: OWNER_ID })
    expect(inbound[0]!.msg.threadId).toBe('77')
  })

  it('refuses a non-owner and never forwards their message or pins them', async () => {
    const { inbound, saveOwnerPin } = await runOnce(
      [{ update_id: 5, message: tgMessage({ from: { id: STRANGER_ID }, text: 'let me in' }) }],
      { ownerUserId: OWNER_ID },
    )
    expect(inbound).toHaveLength(0)
    expect(saveOwnerPin).not.toHaveBeenCalled()
  })

  it('intercepts /start with a greeting and does not forward it to the agent', async () => {
    const { inbound } = await runOnce([{ update_id: 5, message: tgMessage({ text: '/start' }) }], { ownerUserId: OWNER_ID })
    expect(inbound).toHaveLength(0)
  })

  it('ignores non-text updates', async () => {
    const { inbound } = await runOnce([{ update_id: 5, message: { message_id: 2, from: { id: OWNER_ID }, chat: { id: 9000 } } }], { ownerUserId: OWNER_ID })
    expect(inbound).toHaveLength(0)
  })
})

describe('TelegramChannel — trust on first use (no explicit owner)', () => {
  it('pins + forwards the first sender, then locks: a later different user is refused', async () => {
    const { inbound, saveOwnerPin } = await runOnce([
      { update_id: 5, message: tgMessage({ from: { id: OWNER_ID }, text: 'first' }) },
      { update_id: 6, message: tgMessage({ from: { id: STRANGER_ID }, text: 'second' }) },
    ])
    // only the first (pinned owner) is forwarded; the later stranger is refused
    expect(inbound).toHaveLength(1)
    expect(inbound[0]!.msg.body).toBe('first')
    expect(saveOwnerPin).toHaveBeenCalledWith(OWNER_ID)
  })

  it('honors a previously-persisted pin and refuses everyone else', async () => {
    const { inbound, saveOwnerPin } = await runOnce(
      [{ update_id: 5, message: tgMessage({ from: { id: STRANGER_ID }, text: 'hi' }) }],
      { loadOwnerPin: () => OWNER_ID },
    )
    expect(inbound).toHaveLength(0) // stranger refused against the loaded pin
    expect(saveOwnerPin).not.toHaveBeenCalled()
  })
})
