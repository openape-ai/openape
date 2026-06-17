import { describe, expect, it } from 'vitest'
import { ownerOf } from '../server/utils/org-access'

// The read-access contract: an agent reads on behalf of its owner; a human
// is its own owner. (parseAgentEmail itself is covered by agent-email.test.ts.)
describe('ownerOf — org read-access owner derivation', () => {
  it('maps an agent email to its owner', () => {
    expect(ownerOf('ceo-cb6bf26a+patrick+hofmann_eco@id.openape.ai', 'agent')).toBe('patrick@hofmann.eco')
  })

  it('treats a human sub as its own owner', () => {
    expect(ownerOf('patrick@hofmann.eco', 'human')).toBe('patrick@hofmann.eco')
  })

  it('falls back to the sub when an agent email is unparseable', () => {
    expect(ownerOf('weird@id.openape.ai', 'agent')).toBe('weird@id.openape.ai')
  })
})
