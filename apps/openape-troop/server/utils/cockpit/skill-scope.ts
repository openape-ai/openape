export interface RawSkill { id: string, orgId: string, name: string, description: string, assignedTo: string[] }
export interface ScopedSkill { id: string, name: string, description: string, assignedTo: string[] }

// From the owner's skills for `company` (org-scoped, orgId === company) plus the
// owner's library skills (orgId === ''), produce what THIS org's operator sees.
// A library skill is included only if it's assigned to this org's operator ('ceo')
// or one of its agents; its assignedTo is trimmed to those targets so no other
// company's agent ids leak into this org's prompt.
export function resolveOrgSkills(rows: RawSkill[], company: string, teamIds: Set<string>): ScopedSkill[] {
  const out: ScopedSkill[] = []
  for (const s of rows) {
    if (s.orgId === company) {
      out.push({ id: s.id, name: s.name, description: s.description, assignedTo: s.assignedTo })
    }
    else {
      const assignedTo = s.assignedTo.filter(t => t === 'ceo' || teamIds.has(t))
      if (assignedTo.length) out.push({ id: s.id, name: s.name, description: s.description, assignedTo })
    }
  }
  return out
}
