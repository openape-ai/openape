import { describe, expect, it } from 'vitest'
import { parseAgentEmail } from '../server/utils/agent-email'

describe('parseAgentEmail', () => {
  it('parses the canonical hash-suffixed format from deriveAgentEmail', () => {
    const got = parseAgentEmail('igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai')
    expect(got).toEqual({
      agentName: 'igor4',
      ownerLocalpart: 'patrick',
      ownerDomain: 'hofmann.eco',
      ownerEmail: 'patrick@hofmann.eco',
    })
  })

  it('preserves hyphens in the agent name (only the trailing 8-hex hash is stripped)', () => {
    const got = parseAgentEmail('agent-bot1-aabbccdd+patrick+hofmann_eco@id.openape.ai')
    expect(got).toEqual({
      agentName: 'agent-bot1',
      ownerLocalpart: 'patrick',
      ownerDomain: 'hofmann.eco',
      ownerEmail: 'patrick@hofmann.eco',
    })
  })

  it('accepts the older format without owner-hash suffix', () => {
    const got = parseAgentEmail('agenta+patrick+hofmann_eco@id.openape.ai')
    expect(got).toEqual({
      agentName: 'agenta',
      ownerLocalpart: 'patrick',
      ownerDomain: 'hofmann.eco',
      ownerEmail: 'patrick@hofmann.eco',
    })
  })

  it('handles dotted owner-domains (encoded as underscores)', () => {
    const got = parseAgentEmail('alice-12345678+pete+example_co_uk@id.openape.ai')
    expect(got).toEqual({
      agentName: 'alice',
      ownerLocalpart: 'pete',
      ownerDomain: 'example.co.uk',
      ownerEmail: 'pete@example.co.uk',
    })
  })

  it('lowercases the input', () => {
    const got = parseAgentEmail('IGOR4-CB6BF26A+Patrick+Hofmann_Eco@id.openape.ai')
    expect(got).toEqual({
      agentName: 'igor4',
      ownerLocalpart: 'patrick',
      ownerDomain: 'hofmann.eco',
      ownerEmail: 'patrick@hofmann.eco',
    })
  })

  it('rejects non-agent addresses (no `+` subaddressing)', () => {
    expect(parseAgentEmail('patrick@hofmann.eco')).toBeNull()
  })

  it('rejects too few `+` segments', () => {
    expect(parseAgentEmail('alice+patrick@id.openape.ai')).toBeNull()
  })

  it('rejects strings without an @', () => {
    expect(parseAgentEmail('alice-12345678+patrick+hofmann_eco')).toBeNull()
  })

  it('resolves a nest-style agent email to its owner', () => {
    const got = parseAgentEmail('nest-minivonpatrick-cb6bf26a+patrick+hofmann_eco@id.openape.ai')
    expect(got?.ownerEmail).toBe('patrick@hofmann.eco')
    expect(got?.agentName).toBe('nest-minivonpatrick')
  })
})
