import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it, vi } from 'vitest'
import {
  createGrantMailDebouncer,
  GRANT_MAIL_COOLDOWN_MS,
  notifyApproverOfPendingGrantByMail,
} from '../server/utils/grant-mail'

function pendingGrant(overrides: Partial<OpenApeGrant> = {}): OpenApeGrant {
  return {
    id: 'grant-1',
    status: 'pending',
    created_at: 1000,
    request: {
      requester: 'agent@openape.ai',
      target_host: 'chatty',
      audience: 'ape-shell',
      command: ['git', 'push'],
    },
    ...overrides,
  } as OpenApeGrant
}

function makeDeps(overrides: Partial<Parameters<typeof notifyApproverOfPendingGrantByMail>[1]> = {}) {
  return {
    issuer: 'https://id.openape.ai',
    debouncer: createGrantMailDebouncer(),
    resolveApprover: vi.fn(async () => 'owner@example.com'),
    countPendingForApprover: vi.fn(async () => 1),
    sendMail: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('createGrantMailDebouncer', () => {
  it('allows the first send and blocks repeats within the cooldown', () => {
    const debouncer = createGrantMailDebouncer()
    expect(debouncer.shouldSend('a@b.c', 0)).toBe(true)
    expect(debouncer.shouldSend('a@b.c', 1)).toBe(false)
    expect(debouncer.shouldSend('a@b.c', GRANT_MAIL_COOLDOWN_MS - 1)).toBe(false)
  })

  it('allows again once the cooldown has elapsed', () => {
    const debouncer = createGrantMailDebouncer()
    expect(debouncer.shouldSend('a@b.c', 0)).toBe(true)
    expect(debouncer.shouldSend('a@b.c', GRANT_MAIL_COOLDOWN_MS)).toBe(true)
  })

  it('tracks approvers independently', () => {
    const debouncer = createGrantMailDebouncer()
    expect(debouncer.shouldSend('a@b.c', 0)).toBe(true)
    expect(debouncer.shouldSend('x@y.z', 1)).toBe(true)
    expect(debouncer.shouldSend('a@b.c', 2)).toBe(false)
  })

  it('reset reopens the window for one approver only', () => {
    const debouncer = createGrantMailDebouncer()
    debouncer.shouldSend('a@b.c', 0)
    debouncer.shouldSend('x@y.z', 0)
    debouncer.reset('a@b.c')
    expect(debouncer.shouldSend('a@b.c', 1)).toBe(true)
    expect(debouncer.shouldSend('x@y.z', 1)).toBe(false)
  })
})

describe('notifyApproverOfPendingGrantByMail', () => {
  it('sends a mail with approve link, overview link and pending count', async () => {
    const deps = makeDeps({ countPendingForApprover: vi.fn(async () => 3) })
    const result = await notifyApproverOfPendingGrantByMail(pendingGrant(), deps)

    expect(result).toBe('sent')
    expect(deps.sendMail).toHaveBeenCalledWith('owner@example.com', {
      requester: 'agent@openape.ai',
      summary: 'git push',
      approveUrl: 'https://id.openape.ai/grant-approval?grant_id=grant-1',
      overviewUrl: 'https://id.openape.ai/grants',
      pendingCount: 3,
    })
  })

  it('skips grants that are not pending', async () => {
    const deps = makeDeps()
    const result = await notifyApproverOfPendingGrantByMail(
      pendingGrant({ status: 'approved' }),
      deps,
    )
    expect(result).toBe('skipped')
    expect(deps.sendMail).not.toHaveBeenCalled()
  })

  it('skips auto-approved grants even when still marked pending', async () => {
    const deps = makeDeps()
    const result = await notifyApproverOfPendingGrantByMail(
      pendingGrant({ auto_approval_kind: 'yolo' } as Partial<OpenApeGrant>),
      deps,
    )
    expect(result).toBe('skipped')
    expect(deps.sendMail).not.toHaveBeenCalled()
  })

  it('skips when the requester has no user row (no approver resolvable)', async () => {
    const deps = makeDeps({ resolveApprover: vi.fn(async () => null) })
    const result = await notifyApproverOfPendingGrantByMail(pendingGrant(), deps)
    expect(result).toBe('skipped')
    expect(deps.sendMail).not.toHaveBeenCalled()
  })

  it('debounces the second grant for the same approver', async () => {
    const deps = makeDeps()
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant(), deps)).toBe('sent')
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant({ id: 'grant-2' }), deps)).toBe('debounced')
    expect(deps.sendMail).toHaveBeenCalledTimes(1)
  })

  it('does not debounce across different approvers', async () => {
    let approver = 'owner-a@example.com'
    const deps = makeDeps({ resolveApprover: vi.fn(async () => approver) })
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant(), deps)).toBe('sent')
    approver = 'owner-b@example.com'
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant({ id: 'grant-2' }), deps)).toBe('sent')
  })

  it('rethrows a mail failure and reopens the cooldown window', async () => {
    const sendMail = vi.fn(async () => {
      throw new Error('resend down')
    })
    const deps = makeDeps({ sendMail })
    await expect(notifyApproverOfPendingGrantByMail(pendingGrant(), deps)).rejects.toThrow('resend down')

    // The failed attempt must not consume the cooldown — the next
    // pending grant retries instead of going silent for 5 minutes.
    sendMail.mockImplementation(async () => {})
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant({ id: 'grant-2' }), deps)).toBe('sent')
  })

  it('reopens the cooldown window when the pending count lookup fails', async () => {
    const countPendingForApprover = vi.fn(async () => {
      throw new Error('db down')
    })
    const deps = makeDeps({ countPendingForApprover })
    await expect(notifyApproverOfPendingGrantByMail(pendingGrant(), deps)).rejects.toThrow('db down')

    countPendingForApprover.mockImplementation(async () => 1)
    expect(await notifyApproverOfPendingGrantByMail(pendingGrant({ id: 'grant-2' }), deps)).toBe('sent')
  })

  it('escapes the grant id in the approve url', async () => {
    const deps = makeDeps()
    await notifyApproverOfPendingGrantByMail(pendingGrant({ id: 'a b/c' }), deps)
    expect(deps.sendMail).toHaveBeenCalledWith('owner@example.com', expect.objectContaining({
      approveUrl: 'https://id.openape.ai/grant-approval?grant_id=a%20b%2Fc',
    }))
  })
})
