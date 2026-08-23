import { describe, expect, it, vi } from 'vitest'
import { createGrantMailDebouncer } from '../server/utils/grant-mail'
import {
  formatPendingGrantMessage,
  notifyApproverOfPendingGrantByTelegram,
  shortRequester,
} from '../server/utils/grant-telegram'

const OWNER = 'patrick@hofmann.eco'
const ISSUER = 'https://id.openape.ai'

function pendingGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    status: 'pending',
    request: {
      requester: 'op-delta-mind-cb6bf26a+patrick+hofmann_eco@id.openape.ai',
      audience: 'ape-shell',
      grant_type: 'once',
      command: ['bash', '-c', 'o365-cli mail list --top 20'],
    },
    ...overrides,
  } as Parameters<typeof notifyApproverOfPendingGrantByTelegram>[0]
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    chatId: '7758055587',
    approver: OWNER,
    debouncer: createGrantMailDebouncer(60_000),
    resolveApprover: async () => OWNER,
    countPendingForApprover: async () => 1,
    send: vi.fn(async () => {}),
    ...overrides,
  } as Parameters<typeof notifyApproverOfPendingGrantByTelegram>[1] & { send: ReturnType<typeof vi.fn> }
}

describe('shortRequester', () => {
  it('keeps the agent name and drops the owner suffix', () => {
    expect(shortRequester('op-delta-mind-cb6bf26a+patrick+hofmann_eco@id.openape.ai'))
      .toBe('op-delta-mind-cb6bf26a')
  })

  it('leaves a plain address alone apart from the domain', () => {
    expect(shortRequester('agent@example.com')).toBe('agent')
  })
})

describe('formatPendingGrantMessage', () => {
  it('carries the command and a working approval link', () => {
    const text = formatPendingGrantMessage(pendingGrant(), ISSUER, 1)
    expect(text).toContain('op-delta-mind-cb6bf26a')
    expect(text).toContain('bash -c o365-cli mail list --top 20')
    expect(text).toContain(`${ISSUER}/grant-approval?grant_id=grant-1`)
  })

  it('stays quiet about the count when this is the only one waiting', () => {
    expect(formatPendingGrantMessage(pendingGrant(), ISSUER, 1)).not.toContain('waiting')
  })

  it('names the count and links the overview once others are queued', () => {
    const text = formatPendingGrantMessage(pendingGrant(), ISSUER, 4)
    expect(text).toContain('4 waiting')
    expect(text).toContain(`${ISSUER}/grants`)
  })
})

describe('notifyApproverOfPendingGrantByTelegram', () => {
  it('sends for the configured approver', async () => {
    const d = deps()
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant(), d)).resolves.toBe('sent')
    expect(d.send).toHaveBeenCalledWith('7758055587', expect.stringContaining('grant-1'))
  })

  it('sends nothing for somebody else\'s grant — one chat, one human', async () => {
    const d = deps({ resolveApprover: async () => 'stranger@example.com' })
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant(), d)).resolves.toBe('skipped')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('sends nothing when the requester has no user row', async () => {
    const d = deps({ resolveApprover: async () => null })
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant(), d)).resolves.toBe('skipped')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('ignores a grant a pre-approval hook already auto-approved', async () => {
    const d = deps()
    const auto = pendingGrant({ status: 'approved', auto_approval_kind: 'yolo' })
    await expect(notifyApproverOfPendingGrantByTelegram(auto, d)).resolves.toBe('skipped')
    expect(d.send).not.toHaveBeenCalled()
  })

  it('swallows a burst: the second grant inside the window is debounced', async () => {
    const d = deps()
    await notifyApproverOfPendingGrantByTelegram(pendingGrant(), d)
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant({ id: 'grant-2' }), d))
      .resolves
      .toBe('debounced')
    expect(d.send).toHaveBeenCalledTimes(1)
  })

  it('reopens the window when a send fails, so the next request is not swallowed', async () => {
    const send = vi.fn(async () => { throw new Error('HTTP 403 bot was blocked by the user') })
    const d = deps({ send })
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant(), d)).rejects.toThrow('blocked')

    // Same debouncer, immediately after: without the reset this would be
    // silently debounced and the owner would never hear about grant-2.
    const second = vi.fn(async () => {})
    await expect(notifyApproverOfPendingGrantByTelegram(pendingGrant({ id: 'grant-2' }), { ...d, send: second }))
      .resolves
      .toBe('sent')
    expect(second).toHaveBeenCalledTimes(1)
  })
})
