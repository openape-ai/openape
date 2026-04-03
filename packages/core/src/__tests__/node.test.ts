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
    const instance = new Resolver()
    const mockFn = instance.resolveTxt as unknown as ReturnType<typeof vi.fn>
    mockFn.mockResolvedValueOnce([
      ['v=ddisa1 idp=https://idp.example.com'],
      ['some-other-record'],
    ])

    const { resolveTXT } = await import('../dns/node.js')
    const result = await resolveTXT('example.com')
    expect(result).toEqual([
      'v=ddisa1 idp=https://idp.example.com',
      'some-other-record',
    ])
  })

  it('returns empty array for ENOTFOUND', async () => {
    const { Resolver } = await import('node:dns/promises')
    const instance = new Resolver()
    const mockFn = instance.resolveTxt as unknown as ReturnType<typeof vi.fn>
    const err = Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' })
    mockFn.mockRejectedValueOnce(err)

    const { resolveTXT } = await import('../dns/node.js')
    const result = await resolveTXT('notfound.com')
    expect(result).toEqual([])
  })

  it('returns empty array for ENODATA', async () => {
    const { Resolver } = await import('node:dns/promises')
    const instance = new Resolver()
    const mockFn = instance.resolveTxt as unknown as ReturnType<typeof vi.fn>
    const err = Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' })
    mockFn.mockRejectedValueOnce(err)

    const { resolveTXT } = await import('../dns/node.js')
    const result = await resolveTXT('nodata.com')
    expect(result).toEqual([])
  })

  it('returns empty array for SERVFAIL', async () => {
    const { Resolver } = await import('node:dns/promises')
    const instance = new Resolver()
    const mockFn = instance.resolveTxt as unknown as ReturnType<typeof vi.fn>
    const err = Object.assign(new Error('queryTxt SERVFAIL'), { code: 'SERVFAIL' })
    mockFn.mockRejectedValueOnce(err)

    const { resolveTXT } = await import('../dns/node.js')
    const result = await resolveTXT('servfail.com')
    expect(result).toEqual([])
  })

  it('re-throws unknown errors', async () => {
    const { Resolver } = await import('node:dns/promises')
    const instance = new Resolver()
    const mockFn = instance.resolveTxt as unknown as ReturnType<typeof vi.fn>
    const err = Object.assign(new Error('queryTxt REFUSED'), { code: 'REFUSED' })
    mockFn.mockRejectedValueOnce(err)

    const { resolveTXT } = await import('../dns/node.js')
    await expect(resolveTXT('refused.com')).rejects.toThrow('queryTxt REFUSED')
  })
})
