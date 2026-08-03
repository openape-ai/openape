import { describe, expect, it, vi } from 'vitest'

// attention-notify reaches auth and the db through attention-events, both of
// which pull the Nitro runtime; stub them so the pure message builder can be
// unit-tested.
vi.mock('../server/utils/auth', () => ({ requireOwner: vi.fn(), requireAgent: vi.fn() }))
vi.mock('../server/database/drizzle', () => ({
  useDb: () => ({ select: () => ({ from: () => ({ where: () => [] }) }) }),
}))

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('../server/utils/cockpit/push', () => ({ pushToOwner: mockPush }))

const { cardMessage, notifyCardRaised } = await import('../server/utils/attention-notify')

describe('cardMessage', () => {
  it('asks the question itself for a single decision', () => {
    const msg = cardMessage('decision.requested', { question: 'Welche App zuerst?' }, 1)
    expect(msg).toEqual({ title: 'Entscheidung', body: 'Welche App zuerst?' })
  })

  it('names the PR when a verdict is waiting', () => {
    const msg = cardMessage('verdict.requested', { pr_url: 'https://pr.openape.ai/prs/x' }, 1)
    expect(msg).toMatchObject({ title: 'Verdict', body: 'Review wartet: https://pr.openape.ai/prs/x' })
  })

  it('labels an escalation as such', () => {
    expect(cardMessage('work.blocked', { question: 'Blockiert?' }, 1).title).toBe('Eskalation')
  })

  it('summarises to the inbox once several cards are open', () => {
    const msg = cardMessage('decision.requested', { question: 'Frage 3' }, 3)
    expect(msg).toEqual({ title: '3 Entscheidungen warten', body: 'Zuletzt: Frage 3', url: '/inbox' })
  })
})

describe('notifyCardRaised', () => {
  it('buzzes with a deep link to the card itself', async () => {
    mockPush.mockClear()
    await notifyCardRaised('patrick@hofmann.eco', {
      id: '01KZ4C12QZN14SS33ZKKHHKMCQ',
      type: 'decision.requested',
      ts: 1_785_758_183,
      payload: { question: 'Welche App zuerst?' },
    })
    expect(mockPush).toHaveBeenCalledWith('patrick@hofmann.eco', expect.objectContaining({
      url: '/d/01KZ4C12QZN14SS33ZKKHHKMCQ',
      body: 'Welche App zuerst?',
    }))
  })

  it('stays silent for proofs and status events', async () => {
    mockPush.mockClear()
    await notifyCardRaised('patrick@hofmann.eco', {
      id: 'X', type: 'proof.attached', ts: 1, payload: { url: 'https://x', kind: 'pr' },
    })
    expect(mockPush).not.toHaveBeenCalled()
  })
})
