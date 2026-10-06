import { describe, expect, it, vi } from 'vitest'
import { formatRequestMessage, notifyOwnerOfRequest } from '../server/utils/notify'

const row = {
  id: 'r-1',
  ownerEmail: 'patrick@hofmann.eco',
  requester: 'op-openape@id.openape.ai',
  consumerId: 'c-1',
  fieldName: 'NUXT_TELEGRAM_BOT_TOKEN',
  purpose: 'Bot for the OpenApe operator',
  status: 'requested' as const,
  expiresAt: 0,
  boxEpk: null, boxSalt: null, boxIv: null, boxCt: null,
  createdAt: 0, filledAt: null, fetchedAt: null,
}

describe('what the owner reads on their phone', () => {
  it('names the field, the machine and one link', () => {
    const text = formatRequestMessage(row, 'mac mini', 'https://secrets.openape.ai')
    expect(text).toContain('NUXT_TELEGRAM_BOT_TOKEN for mac mini')
    expect(text).toContain('Bot for the OpenApe operator')
    expect(text).toContain('https://secrets.openape.ai/fill/r-1')
  })

  it('falls back to naming the requester when no reason was given', () => {
    const text = formatRequestMessage({ ...row, purpose: '' }, 'mac mini', 'https://x')
    expect(text).toContain('asked by op-openape@id.openape.ai')
  })

  it('never carries a value — there is none yet, and there never will be here', () => {
    const text = formatRequestMessage(row, 'mac mini', 'https://x')
    expect(text).not.toContain('ct')
    expect(text.split('\n').length).toBeLessThan(10)
  })
})

describe('one chat belongs to one person', () => {
  it('sends for the configured approver', async () => {
    const send = vi.fn(async () => {})
    await expect(notifyOwnerOfRequest(row, 'mac', { publicUrl: 'https://x', approver: 'patrick@hofmann.eco', chatId: '1', send })).resolves.toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stays silent for anybody else — a stranger\'s request must not land in this chat', async () => {
    const send = vi.fn(async () => {})
    await expect(notifyOwnerOfRequest({ ...row, ownerEmail: 'fremd@example.com' }, 'mac', { publicUrl: 'https://x', approver: 'patrick@hofmann.eco', chatId: '1', send })).resolves.toBe('skipped')
    expect(send).not.toHaveBeenCalled()
  })
})
