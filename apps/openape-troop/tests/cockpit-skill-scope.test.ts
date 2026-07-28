import { describe, expect, it } from 'vitest'
import { resolveOrgSkills } from '../server/utils/cockpit/skill-scope'

const orgSkill = { id: 'o1', orgId: 'X', name: 'org-only', description: 'd', assignedTo: ['ceo'] }
// A library skill (orgId='') assigned to an agent in X and one in Y.
const libSkill = { id: 'l1', orgId: '', name: 'o365-cli', description: 'd', assignedTo: ['agentX', 'agentY'] }

describe('resolveOrgSkills — library skills scoped per org', () => {
  it('surfaces a library skill for the org holding the assigned agent', () => {
    const r = resolveOrgSkills([orgSkill, libSkill], 'X', new Set(['agentX']))
    const lib = r.find(s => s.id === 'l1')
    expect(lib).toBeTruthy()
    // Only X's target is kept — agentY (another company) must not leak in.
    expect(lib!.assignedTo).toEqual(['agentX'])
  })
  it('does NOT surface the library skill for an org without an assigned agent', () => {
    const r = resolveOrgSkills([libSkill], 'Z', new Set(['agentZ']))
    expect(r).toEqual([])
  })
  it('keeps a ceo-assigned library skill for any org', () => {
    const ceoLib = { id: 'l2', orgId: '', name: 'k', description: 'd', assignedTo: ['ceo'] }
    const r = resolveOrgSkills([ceoLib], 'anything', new Set())
    expect(r).toHaveLength(1)
    expect(r[0]!.assignedTo).toEqual(['ceo'])
  })
  it('passes org-scoped skills through untouched', () => {
    const r = resolveOrgSkills([orgSkill], 'X', new Set())
    expect(r).toHaveLength(1)
    expect(r[0]!.id).toBe('o1')
  })
})
