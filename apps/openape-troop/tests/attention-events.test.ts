import type { H3Event } from 'h3'
import { describe, expect, it, vi } from 'vitest'

const { mockRequireOwner, mockRequireAgent, mockAgentRow } = vi.hoisted(() => ({
  mockRequireOwner: vi.fn(),
  mockRequireAgent: vi.fn(),
  mockAgentRow: vi.fn(),
}))
vi.mock('../server/utils/auth', () => ({ requireOwner: mockRequireOwner, requireAgent: mockRequireAgent }))
vi.mock('../server/database/drizzle', () => ({
  useDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: mockAgentRow }) }) }),
  }),
}))

// Nitro auto-imports resolve via globalThis outside Nuxt.
vi.stubGlobal('createError', (e: { statusCode: number, statusMessage?: string }) =>
  Object.assign(new Error(e.statusMessage ?? 'http'), e))

const { parseSince, resolveEventOwner } = await import('../server/utils/attention-events')

const event = {} as H3Event
const NOW = 1_785_758_183

describe('parseSince', () => {
  it('returns null for absent input', () => {
    expect(parseSince(undefined, NOW)).toBeNull()
    expect(parseSince('', NOW)).toBeNull()
  })

  it.each([
    ['-30s', NOW - 30],
    ['-1m', NOW - 60],
    ['-1h', NOW - 3600],
    ['-2d', NOW - 2 * 86400],
  ])('resolves relative offset %s', (input, expected) => {
    expect(parseSince(input, NOW)).toBe(expected)
  })

  it('passes through absolute unix seconds', () => {
    expect(parseSince('1785758183', NOW)).toBe(1785758183)
  })

  it.each([['yesterday'], ['-1w'], ['1h'], ['-h'], ['--1h']])('throws 400 on %s', (input) => {
    expect(() => parseSince(input, NOW)).toThrowError(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('resolveEventOwner', () => {
  it('prefers the owner identity when present', async () => {
    mockRequireOwner.mockResolvedValueOnce('patrick@hofmann.eco')
    expect(await resolveEventOwner(event)).toBe('patrick@hofmann.eco')
    expect(mockRequireAgent).not.toHaveBeenCalled()
  })

  it('maps an agent bearer to its registered owner', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('401'))
    mockRequireAgent.mockResolvedValueOnce('agent+a1+hofmann_eco@id.openape.ai')
    mockAgentRow.mockResolvedValueOnce({ ownerEmail: 'patrick@hofmann.eco' })
    expect(await resolveEventOwner(event)).toBe('patrick@hofmann.eco')
  })

  it('rejects agents troop does not know with 403', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('401'))
    mockRequireAgent.mockResolvedValueOnce('agent+ghost+nowhere@id.openape.ai')
    mockAgentRow.mockResolvedValueOnce(undefined)
    await expect(resolveEventOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })
})
