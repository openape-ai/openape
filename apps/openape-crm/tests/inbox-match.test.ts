import { describe, expect, it } from 'vitest'
import { matchInboxAddresses } from '../shared/inbox'

const contacts = [
  { contactId: 'c1', email: 'julia@keplerlabs.io' },
  { contactId: 'c2', email: 'max@muster.at' },
]

describe('matchInboxAddresses', () => {
  it('matches a sender who is a CRM contact', () => {
    expect(matchInboxAddresses({
      from: 'Julia@keplerlabs.io',
      to: ['patrick@openape.ai'],
      selfMail: 'patrick@openape.ai',
      contactEmails: contacts,
    })).toEqual({ contactId: 'c1', email: 'julia@keplerlabs.io' })
  })

  it('matches a recipient other than the connected mailbox', () => {
    expect(matchInboxAddresses({
      from: 'unknown@example.com',
      to: ['max@muster.at', 'patrick@openape.ai'],
      selfMail: 'patrick@openape.ai',
      contactEmails: contacts,
    })?.contactId).toBe('c2')
  })

  it('returns null when nobody besides self is a contact', () => {
    expect(matchInboxAddresses({
      from: 'spam@example.com',
      to: ['patrick@openape.ai'],
      selfMail: 'patrick@openape.ai',
      contactEmails: contacts,
    })).toBeNull()
  })
})
