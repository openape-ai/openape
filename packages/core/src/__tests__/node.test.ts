import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => {
  const mockResolveTxt = vi.fn()
  return {
    Resolver: vi.fn().mockImplementation(() => ({
      resolveTxt: mockResolveTxt,
    })),
    __mockResolveTxt: mockResolveTxt,
  }
})

describe('node resolveTXT', () => {
  it('returns flattened TXT records on success', async () => {
    const { Resolver } = await import('node:dns/promises')
    const mockFn = new Resolver().resolveTxt as unknown as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValueOnce([['record-a'], ['record-b']])

    const { resolveTXT } = await import('../dns/node.js')
    expect(await resolveTXT('example.com')).toEqual(['record-a', 'record-b'])
  })

  it('returns empty array for known DNS errors (ENOTFOUND/ENODATA/SERVFAIL)', async () => {
    const { Resolver } = await import('node:dns/promises')
    const mockFn = new Resolver().resolveTxt as unknown as ReturnType<typeof vi.fn>
    mockFn.mockRejectedValueOnce(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))

    const { resolveTXT } = await import('../dns/node.js')
    expect(await resolveTXT('notfound.com')).toEqual([])
  })

  it('re-throws unknown errors', async () => {
    const { Resolver } = await import('node:dns/promises')
    const mockFn = new Resolver().resolveTxt as unknown as ReturnType<typeof vi.fn>
    mockFn.mockRejectedValueOnce(Object.assign(new Error('REFUSED'), { code: 'REFUSED' }))

    const { resolveTXT } = await import('../dns/node.js')
    await expect(resolveTXT('refused.com')).rejects.toThrow('REFUSED')
  })
})
