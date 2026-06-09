import { describe, expect, it } from 'vitest'
import { deriveAgentEmail } from '../server/utils/agent-email'

describe('deriveAgentEmail', () => {
  it('uses the issuing IdP host as the agent email domain', () => {
    // The whole point of the fix: the domain tracks the issuer, not a literal.
    expect(deriveAgentEmail('patrick@example.com', 'bot', 'id.openape.test'))
      .toMatch(/@id\.openape\.test$/)
    // Flagship is unchanged — issuer host id.openape.ai → @id.openape.ai.
    expect(deriveAgentEmail('patrick@example.com', 'bot', 'id.openape.ai'))
      .toMatch(/@id\.openape\.ai$/)
  })

  it('keeps the owner-encoding + hash + name-sanitisation otherwise intact', () => {
    // name lowercased & non-[a-z0-9-]→'-'; owner local kept as-is; owner domain
    // dots→'_'; 8-hex owner hash; joined with '+'.
    expect(deriveAgentEmail('Foo.Bar@example.com', 'My Bot', 'id.openape.test'))
      .toMatch(/^my-bot-[0-9a-f]{8}\+Foo\.Bar\+example_com@id\.openape\.test$/)
  })

  it('is stable for the same owner + name + issuer host', () => {
    expect(deriveAgentEmail('x@y.z', 'b', 'h.test'))
      .toBe(deriveAgentEmail('x@y.z', 'b', 'h.test'))
  })
})
