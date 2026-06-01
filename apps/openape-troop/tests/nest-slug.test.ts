import { describe, expect, it } from 'vitest'
import { pickUniqueHostId, slugifyHostId } from '../server/utils/nest-slug'

describe('nest host_id minting (M4δ)', () => {
  it('slugifies a display name to a url-safe host_id', () => {
    expect(slugifyHostId('MacBook Pro (home)')).toBe('macbook-pro-home')
    expect(slugifyHostId('mbp-home')).toBe('mbp-home')
    expect(slugifyHostId('  Patrick’s Mac mini  ')).toBe('patrick-s-mac-mini')
  })

  it('falls back to "pod" when nothing slugifiable remains', () => {
    expect(slugifyHostId('!!!')).toBe('pod')
    expect(slugifyHostId('')).toBe('pod')
  })

  it('caps length at 48 chars', () => {
    expect(slugifyHostId('a'.repeat(100)).length).toBe(48)
  })

  it('picks base when unused', () => {
    expect(pickUniqueHostId('macbook', new Set())).toBe('macbook')
    expect(pickUniqueHostId('macbook', new Set(['laptop']))).toBe('macbook')
  })

  it('appends an incrementing suffix on collision', () => {
    expect(pickUniqueHostId('macbook', new Set(['macbook']))).toBe('macbook-2')
    expect(pickUniqueHostId('macbook', new Set(['macbook', 'macbook-2']))).toBe('macbook-3')
  })
})
