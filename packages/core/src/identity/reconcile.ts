import type { ParsedAgentEmail } from './agent-email.js'
import { parseAgentEmail } from './agent-email.js'

// One agent identity is the DDISA agent email. Today it is copied, keyed only
// by that email string, into four stores: the IdP (which mints it), troop
// `agents`, org `org_members`, and a tasks team's `team_members`. The email is
// the natural join key — this reconciler resolves a single identity across the
// three queryable stores (the IdP is the key's namespace) and reports drift,
// so we can see which agents are linked everywhere vs. only partially.

export interface ReconcileInput {
  /** org_members rows for one organization */
  org: Array<{ agentEmail: string }>
  /** troop agents owned by the same owner */
  troop: Array<{ email: string }>
  /** team_members of the tasks team bound to that org */
  tasks: Array<{ userEmail: string }>
}

export type IdentityStatus = 'linked' | 'partial'

export interface ResolvedIdentity extends ParsedAgentEmail {
  email: string
  inOrg: boolean
  inTroop: boolean
  inTasks: boolean
  /**
   * Identity coherence across the two agent registries: linked = present in
   * both org and troop; partial = missing from one. Tasks-team membership
   * (`inTasks`) is an informational binding axis, reported but not part of the
   * status — a coherent agent need not be on every team.
   */
  status: IdentityStatus
}

export interface ReconcileSummary {
  total: number
  linked: number
  partial: number
  /** non-agent (human) emails encountered and skipped */
  humansSkipped: number
}

export interface ReconcileResult {
  identities: ResolvedIdentity[]
  summary: ReconcileSummary
}

interface Acc {
  parsed: ParsedAgentEmail
  inOrg: boolean
  inTroop: boolean
  inTasks: boolean
}

/**
 * Resolve every agent identity across org/troop/tasks and flag drift.
 * Human emails (which do not match the agent convention) are skipped, so owner
 * rows never pollute the report. Case is normalized; the same identity in
 * multiple stores collapses to one row. Result is sorted by agent name.
 */
export function reconcileIdentities(input: ReconcileInput): ReconcileResult {
  const byEmail = new Map<string, Acc>()
  let humansSkipped = 0

  const visit = (raw: string, store: 'org' | 'troop' | 'tasks') => {
    const parsed = parseAgentEmail(raw)
    if (!parsed) {
      humansSkipped++
      return
    }
    const key = raw.toLowerCase()
    let acc = byEmail.get(key)
    if (!acc) {
      acc = { parsed, inOrg: false, inTroop: false, inTasks: false }
      byEmail.set(key, acc)
    }
    acc[store === 'org' ? 'inOrg' : store === 'troop' ? 'inTroop' : 'inTasks'] = true
  }

  for (const r of input.org) visit(r.agentEmail, 'org')
  for (const r of input.troop) visit(r.email, 'troop')
  for (const r of input.tasks) visit(r.userEmail, 'tasks')

  const identities: ResolvedIdentity[] = Array.from(byEmail, ([email, acc]) => ({
    email,
    ...acc.parsed,
    inOrg: acc.inOrg,
    inTroop: acc.inTroop,
    inTasks: acc.inTasks,
    status: (acc.inOrg && acc.inTroop ? 'linked' : 'partial') as IdentityStatus,
  }))

  identities.sort((a, b) => a.agentName.localeCompare(b.agentName))

  return {
    identities,
    summary: {
      total: identities.length,
      linked: identities.filter(i => i.status === 'linked').length,
      partial: identities.filter(i => i.status === 'partial').length,
      humansSkipped,
    },
  }
}
