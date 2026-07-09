import { describe, expect, it } from 'vitest'
import { buildOrgTree } from '../server/utils/cockpit/tree'

function r(id: string, label: string, role: string, reportsTo: string | null) {
  return { id, label, role, reportsTo, duties: '', tools: [] as string[], enabled: true }
}

describe('buildOrgTree', () => {
  it('nests reports under their supervisor, CEO at the root', () => {
    const roots = buildOrgTree([
      r('ceo', 'CEO', 'ceo', null),
      r('sm', 'Scrum Manager', 'teamlead', 'ceo'),
      r('dev', 'Programmierer', 'specialist', 'sm'),
      r('qa', 'Tester', 'specialist', 'sm'),
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.label).toBe('CEO')
    expect(roots[0]!.children.map(c => c.label)).toEqual(['Scrum Manager'])
    expect(roots[0]!.children[0]!.children.map(c => c.label).sort()).toEqual(['Programmierer', 'Tester'])
  })
  it('a role whose supervisor is gone becomes a root', () => {
    const roots = buildOrgTree([r('x', 'Waise', 'specialist', 'nonexistent')])
    expect(roots.map(n => n.label)).toEqual(['Waise'])
  })
  it('is cycle-safe (a→b→a does not loop)', () => {
    const roots = buildOrgTree([r('a', 'A', 'specialist', 'b'), r('b', 'B', 'specialist', 'a')])
    expect(roots.length).toBeGreaterThanOrEqual(1)
  })
})
