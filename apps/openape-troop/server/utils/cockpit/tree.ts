export type Vars = Record<string, unknown>
export interface FlatRole { id: string, role: string, label: string, duties: string, procedure: string, vars: Vars, tools: string[], enabled: boolean, reportsTo: string | null }
export interface OrgNode { id: string, role: string, label: string, duties: string, procedure: string, vars: Vars, tools: string[], enabled: boolean, children: OrgNode[] }

// Build the org hierarchy from flat rows. Roots = report to the Owner (no parent
// or a parent that no longer exists). Cycle-safe (a role never becomes its own
// ancestor). Deterministic order: CEO first, then by label.
//
// `orgVars` are the company's facts (board, lanes, tags); a role's own `vars`
// are its personal ones (its board user id) and win on conflict. Merged here so
// every consumer of the tree sees the same view.
export function buildOrgTree(rows: FlatRole[], orgVars: Vars = {}): OrgNode[] {
  const nodes = new Map<string, OrgNode & { reportsTo: string | null }>(
    rows.map(r => [r.id, { id: r.id, role: r.role, label: r.label, duties: r.duties, procedure: r.procedure, vars: { ...orgVars, ...r.vars }, tools: r.tools, enabled: r.enabled, reportsTo: r.reportsTo, children: [] }]),
  )
  const isAncestor = (candidate: string, of: string): boolean => {
    let cur = nodes.get(of)?.reportsTo
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (cur === candidate) return true
      seen.add(cur)
      cur = nodes.get(cur)?.reportsTo
    }
    return false
  }
  const roots: OrgNode[] = []
  for (const n of nodes.values()) {
    const parent = n.reportsTo ? nodes.get(n.reportsTo) : undefined
    if (parent && parent.id !== n.id && !isAncestor(n.id, parent.id)) parent.children.push(n)
    else roots.push(n)
  }
  const sortRec = (list: OrgNode[]) => {
    list.sort((a, b) => (a.role === 'ceo' ? 0 : 1) - (b.role === 'ceo' ? 0 : 1) || a.label.localeCompare(b.label))
    for (const n of list) sortRec(n.children)
  }
  sortRec(roots)
  return roots
}
