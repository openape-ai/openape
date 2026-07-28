import { describe, expect, it } from 'vitest'
import { buildCompanyTree } from '../src/agent-tree'
import type { AgentRow } from '../src/troop-api'

function agent(agentName: string, over: Partial<AgentRow> = {}): AgentRow {
  return {
    email: `${agentName}@id.openape.ai`,
    agentName,
    hostId: null,
    hostname: null,
    lastSeenAt: null,
    createdAt: 0,
    taskCount: 0,
    lastRunStatus: null,
    lastRunAt: null,
    orgId: null,
    orgName: null,
    orgRole: null,
    reportsToEmail: null,
    ...over,
  }
}

const IN_OPENAPE = { orgId: 'o1', orgName: 'OpenApe' }

describe('buildCompanyTree', () => {
  it('groups agents by company, alphabetically', () => {
    const tree = buildCompanyTree([
      agent('dm-ceo', { orgId: 'o2', orgName: 'Delta Mind', orgRole: 'ceo' }),
      agent('ceo', { ...IN_OPENAPE, orgRole: 'ceo' }),
    ])
    expect(tree.map(g => g.company)).toEqual(['Delta Mind', 'OpenApe'])
  })

  it('nests reports under the agent they report to', () => {
    const [openape] = buildCompanyTree([
      agent('backend', { ...IN_OPENAPE, orgRole: 'specialist', reportsToEmail: 'pm@id.openape.ai' }),
      agent('pm', { ...IN_OPENAPE, orgRole: 'teamlead' }),
    ])
    expect(openape!.roots.map(n => n.agent.agentName)).toEqual(['pm'])
    expect(openape!.roots[0]!.reports.map(n => n.agent.agentName)).toEqual(['backend'])
  })

  it('treats an agent without a parent as a root — CEO and Sanierer report to the owner', () => {
    const [openape] = buildCompanyTree([
      agent('cfo', { ...IN_OPENAPE, orgRole: 'sanierer' }),
      agent('ceo', { ...IN_OPENAPE, orgRole: 'ceo' }),
    ])
    expect(openape!.roots.map(n => n.agent.agentName).sort()).toEqual(['ceo', 'cfo'])
  })

  it('collects agents without a company in their own trailing group', () => {
    const tree = buildCompanyTree([
      agent('zaz'),
      agent('ceo', { ...IN_OPENAPE, orgRole: 'ceo' }),
    ])
    expect(tree.map(g => g.company)).toEqual(['OpenApe', null])
    expect(tree[1]!.roots.map(n => n.agent.agentName)).toEqual(['zaz'])
  })

  it('keeps an agent whose parent is missing — surfaced as a root, never dropped', () => {
    const [openape] = buildCompanyTree([
      agent('orphan', { ...IN_OPENAPE, orgRole: 'specialist', reportsToEmail: 'retired@id.openape.ai' }),
    ])
    expect(openape!.roots.map(n => n.agent.agentName)).toEqual(['orphan'])
  })

  it('survives a reportsTo cycle without recursing forever', () => {
    const [openape] = buildCompanyTree([
      agent('a', { ...IN_OPENAPE, reportsToEmail: 'b@id.openape.ai' }),
      agent('b', { ...IN_OPENAPE, reportsToEmail: 'a@id.openape.ai' }),
    ])
    const names = openape!.roots.flatMap(function walk(n): string[] {
      return [n.agent.agentName, ...n.reports.flatMap(walk)]
    })
    expect(names.sort()).toEqual(['a', 'b'])
  })

  it('ignores a parent in another company — hierarchy never crosses companies', () => {
    const tree = buildCompanyTree([
      agent('lead', { orgId: 'o2', orgName: 'Delta Mind' }),
      agent('report', { ...IN_OPENAPE, reportsToEmail: 'lead@id.openape.ai' }),
    ])
    const openape = tree.find(g => g.company === 'OpenApe')!
    expect(openape.roots.map(n => n.agent.agentName)).toEqual(['report'])
  })
})
