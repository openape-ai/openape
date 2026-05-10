import { describe, expect, it } from 'vitest'
import { shouldAutoAccept } from '../src/identity'

describe('shouldAutoAccept', () => {
  const identity = {
    email: 'agent-x+patrick+hofmann_eco@id.openape.ai',
    ownerEmail: 'patrick@hofmann.eco',
    idp: 'https://id.openape.ai',
  }

  it('always accepts requests from the agent owner', () => {
    expect(shouldAutoAccept('patrick@hofmann.eco', identity, new Set())).toBe(true)
  })

  it('is case-insensitive on the owner check', () => {
    expect(shouldAutoAccept('PATRICK@HOFMANN.eco', identity, new Set())).toBe(true)
    const upperIdentity = { ...identity, ownerEmail: 'PATRICK@HOFMANN.ECO' }
    expect(shouldAutoAccept('patrick@hofmann.eco', upperIdentity, new Set())).toBe(true)
  })

  it('accepts requests from peers on the explicit allowlist', () => {
    const allow = new Set(['colleague@delta-mind.at'])
    expect(shouldAutoAccept('colleague@delta-mind.at', identity, allow)).toBe(true)
    expect(shouldAutoAccept('Colleague@Delta-Mind.AT', identity, allow)).toBe(true)
  })

  it('rejects requests from random peers (not owner, not on allowlist)', () => {
    expect(shouldAutoAccept('random@stranger.example', identity, new Set())).toBe(false)
    expect(shouldAutoAccept('phisher@somewhere.example', identity, new Set(['ok@trusted.example']))).toBe(false)
  })

  it('does not treat the agent itself as auto-acceptable (defense-in-depth)', () => {
    // Theoretical: an agent should never be in the position of "trying to
    // contact itself", but if a peer happened to have the same email as
    // the agent, allowlist semantics still apply normally — the owner
    // check would fail and an empty allowlist would reject.
    expect(shouldAutoAccept(identity.email, identity, new Set())).toBe(false)
  })
})
