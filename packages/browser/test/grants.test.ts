import { describe, expect, it } from 'vitest'
import { resolveIdpUrl } from '../src/grants'

describe('resolveIdpUrl', () => {
  it('uses explicit IdP URL', () => {
    expect(resolveIdpUrl('https://id.openape.at', { email: 'agent@test.com' }))
      .toBe('https://id.openape.at')
  })

  it('extracts domain from agent email', () => {
    expect(resolveIdpUrl(undefined, { email: 'agent+patrick@id.openape.at' }))
      .toBe('https://id.openape.at')
  })

  it('throws if no IdP and no domain in email', () => {
    expect(() => resolveIdpUrl(undefined, { email: 'nodomain' }))
      .toThrow('Cannot resolve IdP URL')
  })
})
