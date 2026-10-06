import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '../app/utils/return-to'

describe('safeReturnPath', () => {
  it('keeps an in-app path', () => {
    expect(safeReturnPath('/repos/patrick/monorepo/pulls/1')).toBe('/repos/patrick/monorepo/pulls/1')
  })

  it('keeps query and hash', () => {
    expect(safeReturnPath('/repos/p/m/tree/src?ref=main#L20')).toBe('/repos/p/m/tree/src?ref=main#L20')
  })

  it('rejects an absolute URL', () => {
    expect(safeReturnPath('https://evil.example/steal')).toBeNull()
  })

  it('rejects a protocol-relative URL', () => {
    // `//evil.example` is a valid absolute URL to the browser but starts with
    // a slash, so a naive startsWith('/') check would send the user off-site.
    expect(safeReturnPath('//evil.example/steal')).toBeNull()
  })

  it('rejects a backslash-escaped host', () => {
    expect(safeReturnPath('/\\evil.example')).toBeNull()
  })

  it('rejects a path that is not a path', () => {
    expect(safeReturnPath('repos/p/m')).toBeNull()
    expect(safeReturnPath('')).toBeNull()
    expect(safeReturnPath(null)).toBeNull()
  })
})
