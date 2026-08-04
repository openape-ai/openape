import { describe, expect, it } from 'vitest'
import { displayName, showEdited } from '../app/utils/message'

describe('displayName', () => {
  it('strips the owner hash and owner address off a DDISA agent address', () => {
    expect(displayName('igor30-cb6bf26a+patrick+hofmann_eco@id.openape.ai')).toBe('igor30')
  })

  it('keeps an agent name that contains dashes of its own', () => {
    expect(displayName('mail-triage-cb6bf26a+patrick+hofmann_eco@id.openape.ai')).toBe('mail-triage')
  })

  it('falls back to the local part for humans and federated logins', () => {
    expect(displayName('patrick@hofmann.eco')).toBe('patrick')
    expect(displayName('someone@id.openape.ai')).toBe('someone')
  })

  it('leaves an address without an @ alone', () => {
    expect(displayName('system')).toBe('system')
  })
})

describe('showEdited', () => {
  const base = { senderEmail: 'a@b.c', createdAt: 1000, editedAt: null, streaming: false }

  it('stays silent while a message is still streaming', () => {
    expect(showEdited({ ...base, editedAt: 2000, streaming: true })).toBe(false)
  })

  it('stays silent for a message that was never edited', () => {
    expect(showEdited(base)).toBe(false)
  })

  it('swallows the stream-end PATCH that lands right after creation', () => {
    // The exact case the grace window exists for: without it every agent
    // message would light up "(edited)" the moment streaming flips false.
    expect(showEdited({ ...base, editedAt: 1002 })).toBe(false)
  })

  it('marks a real edit later on', () => {
    expect(showEdited({ ...base, editedAt: 1003 })).toBe(true)
  })
})
