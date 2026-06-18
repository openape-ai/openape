import { describe, expect, it } from 'vitest'
import { parseAgentEmail, reconcileIdentities } from '../identity/index.js'

describe('parseAgentEmail', () => {
  it('parses the canonical hashed three-segment shape', () => {
    const r = parseAgentEmail('igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai')
    expect(r).toEqual({
      agentName: 'igor4',
      ownerLocalpart: 'patrick',
      ownerDomain: 'hofmann.eco',
      ownerEmail: 'patrick@hofmann.eco',
    })
  })

  it('parses the older non-hashed shape', () => {
    const r = parseAgentEmail('pm+patrick+hofmann_eco@id.openape.ai')
    expect(r?.agentName).toBe('pm')
    expect(r?.ownerEmail).toBe('patrick@hofmann.eco')
  })

  it('is case-insensitive', () => {
    const r = parseAgentEmail('PM-CB6BF26A+Patrick+Hofmann_Eco@ID.openape.ai')
    expect(r?.agentName).toBe('pm')
    expect(r?.ownerEmail).toBe('patrick@hofmann.eco')
  })

  it('returns null for a plain human email', () => {
    expect(parseAgentEmail('patrick@hofmann.eco')).toBeNull()
  })

  it('returns null when there is no @', () => {
    expect(parseAgentEmail('not-an-email')).toBeNull()
  })

  it('returns null when a subaddress segment is empty', () => {
    expect(parseAgentEmail('name+local+@id.openape.ai')).toBeNull() // empty domain
    expect(parseAgentEmail('name++domain@id.openape.ai')).toBeNull() // empty owner-local
    expect(parseAgentEmail('+local+domain@id.openape.ai')).toBeNull() // empty name
  })
})

describe('reconcileIdentities', () => {
  const ceo = 'dm-ceo-cb6bf26a+patrick+hofmann_eco@id.openape.ai'
  const pm = 'pm-cb6bf26a+patrick+hofmann_eco@id.openape.ai'
  const scribe = 'scribe-cb6bf26a+patrick+hofmann_eco@id.openape.ai'

  it('marks an identity present in all three stores as linked', () => {
    const r = reconcileIdentities({
      org: [{ agentEmail: ceo }],
      troop: [{ email: ceo }],
      tasks: [{ userEmail: ceo }],
    })
    expect(r.identities).toHaveLength(1)
    expect(r.identities[0]).toMatchObject({ email: ceo, inOrg: true, inTroop: true, inTasks: true, status: 'linked' })
    expect(r.summary).toMatchObject({ total: 1, linked: 1, partial: 0 })
  })

  it('flags an org member with no troop agent as partial drift', () => {
    const r = reconcileIdentities({
      org: [{ agentEmail: pm }],
      troop: [],
      tasks: [{ userEmail: pm }],
    })
    expect(r.identities[0]).toMatchObject({ inOrg: true, inTroop: false, inTasks: true, status: 'partial' })
    expect(r.summary.partial).toBe(1)
  })

  it('normalizes case and dedupes the same identity across stores', () => {
    const r = reconcileIdentities({
      org: [{ agentEmail: scribe.toUpperCase() }],
      troop: [{ email: scribe }],
      tasks: [],
    })
    expect(r.identities).toHaveLength(1)
    expect(r.identities[0]?.email).toBe(scribe)
  })

  it('ignores human (non-agent) emails so owner rows do not pollute the report', () => {
    const r = reconcileIdentities({
      org: [],
      troop: [],
      tasks: [{ userEmail: 'patrick@hofmann.eco' }],
    })
    expect(r.identities).toHaveLength(0)
    expect(r.summary.humansSkipped).toBe(1)
  })

  it('sorts identities by agent name for stable reports', () => {
    const r = reconcileIdentities({
      org: [{ agentEmail: scribe }, { agentEmail: ceo }, { agentEmail: pm }],
      troop: [{ email: ceo }, { email: pm }, { email: scribe }],
      tasks: [],
    })
    expect(r.identities.map(i => i.agentName)).toEqual(['dm-ceo', 'pm', 'scribe'])
  })
})
