import { describe, expect, it } from 'vitest'
import { buildOrgTree } from '../server/utils/cockpit/tree'

function r(id: string, label: string, role: string, reportsTo: string | null, extra: Partial<{ procedure: string, vars: Record<string, unknown>, injectionScore: number, injectionReason: string }> = {}) {
  return { id, label, role, reportsTo, duties: '', tools: [] as string[], enabled: true, procedure: '', vars: {}, injectionScore: 0, injectionReason: '', ...extra }
}

describe('buildOrgTree', () => {
  it('nests reports under their supervisor, Operator at the root', () => {
    const roots = buildOrgTree([
      r('ceo', 'Operator', 'ceo', null),
      r('sm', 'Scrum Manager', 'teamlead', 'ceo'),
      r('dev', 'Programmierer', 'specialist', 'sm'),
      r('qa', 'Tester', 'specialist', 'sm'),
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0]!.label).toBe('Operator')
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
  it('carries the procedure through untouched', () => {
    const roots = buildOrgTree([r('dev', 'Programmierer', 'specialist', null, { procedure: '## Schritt 1\nworktree anlegen' })])
    expect(roots[0]!.procedure).toBe('## Schritt 1\nworktree anlegen')
  })
  it('carries the injection score + reason through so the loop guard can read it', () => {
    const roots = buildOrgTree([r('dev', 'Programmierer', 'specialist', null, { injectionScore: 0.85, injectionReason: 'override-attempt' })])
    expect(roots[0]!.injectionScore).toBe(0.85)
    expect(roots[0]!.injectionReason).toBe('override-attempt')
  })
  it('merges org vars into every node, employee wins', () => {
    const roots = buildOrgTree(
      [
        r('ceo', 'Operator', 'ceo', null),
        r('dev', 'Programmierer', 'specialist', 'ceo', { vars: { boardUser: 254, project: 999 } }),
      ],
      { project: 125, lanes: { sprint: 2617 } },
    )
    expect(roots[0]!.vars).toEqual({ project: 125, lanes: { sprint: 2617 } })
    expect(roots[0]!.children[0]!.vars).toEqual({ project: 999, lanes: { sprint: 2617 }, boardUser: 254 })
  })
  it('a node without vars still gets the org vars, never undefined', () => {
    const roots = buildOrgTree([r('ceo', 'Operator', 'ceo', null)], { project: 125 })
    expect(roots[0]!.vars).toEqual({ project: 125 })
  })
  it('no org vars and no employee vars yields an empty object', () => {
    const roots = buildOrgTree([r('ceo', 'Operator', 'ceo', null)])
    expect(roots[0]!.vars).toEqual({})
  })
})
