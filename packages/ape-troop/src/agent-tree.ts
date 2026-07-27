import type { AgentRow } from './troop-api'

export interface AgentNode {
  agent: AgentRow
  reports: AgentNode[]
}

/** One company's agents. `company` is null for agents with no org membership. */
export interface CompanyGroup {
  company: string | null
  roots: AgentNode[]
}

/**
 * Group agents by company and rebuild the reporting hierarchy from
 * `reportsToEmail`. A company's roots are the agents reporting to nobody —
 * the Operator/CEO and the Sanierer, who both answer to the owner.
 *
 * Nothing is ever dropped: an agent whose parent left the company (or points
 * outside it) surfaces as a root, and a `reportsTo` cycle is broken at the
 * first agent already claimed as someone's report. A missing agent in the
 * output would read as "this agent is gone", which is worse than a flat one.
 */
export function buildCompanyTree(rows: AgentRow[]): CompanyGroup[] {
  const byCompany = new Map<string | null, AgentRow[]>()
  for (const row of rows) {
    const key = row.orgName ?? null
    const bucket = byCompany.get(key)
    if (bucket) bucket.push(row)
    else byCompany.set(key, [row])
  }

  const named = [...byCompany.keys()].filter(k => k !== null).sort((a, b) => a!.localeCompare(b!))
  const order: (string | null)[] = byCompany.has(null) ? [...named, null] : named

  return order.map(company => ({ company, roots: linkReports(byCompany.get(company)!) }))
}

function linkReports(members: AgentRow[]): AgentNode[] {
  const sorted = [...members].sort((a, b) => a.agentName.localeCompare(b.agentName))
  const nodes = new Map<string, AgentNode>()
  for (const agent of sorted) nodes.set(agent.email, { agent, reports: [] })

  const claimed = new Set<string>()
  for (const node of nodes.values()) {
    const parent = node.agent.reportsToEmail ? nodes.get(node.agent.reportsToEmail) : undefined
    // Claiming before descending keeps a cycle (a→b→a) from nesting forever:
    // the second edge finds its target already claimed and is left as a root.
    if (!parent || parent === node || claimed.has(parent.agent.email)) continue
    parent.reports.push(node)
    claimed.add(node.agent.email)
  }

  return [...nodes.values()].filter(n => !claimed.has(n.agent.email))
}
