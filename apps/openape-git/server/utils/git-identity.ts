// Pure DDISA claim → transport identity mapping (no runtime imports, testable).

export type GitTokenCap = 'read' | 'write' | 'admin' | 'none'

export interface GitIdentity {
  /** The identity actually performing the push/fetch (agent for delegated tokens). */
  email: string
  act: 'human' | 'agent'
  /** Set for delegated tokens: the principal (token sub) the actor works for. */
  delegator?: string
  /**
   * Highest git access the token itself allows. Undefined = unscoped token
   * (apes login), no cap. 'none' = the token carries a scope list without any
   * git:* scope — it was delegated for something else and must not touch git.
   */
  cap?: GitTokenCap
}

function capFromScope(scope: unknown): GitTokenCap | undefined {
  if (!Array.isArray(scope)) return undefined
  let cap: GitTokenCap = 'none'
  const rank = { none: 0, read: 1, write: 2, admin: 3 }
  for (const entry of scope) {
    if (entry !== 'git:read' && entry !== 'git:write' && entry !== 'git:admin') continue
    const access = (entry as string).slice('git:'.length) as GitTokenCap
    if (rank[access] > rank[cap]) cap = access
  }
  return cap
}

/**
 * DDISA token shapes the transport accepts:
 *   direct:      { sub: email, act: 'human' | 'agent' }
 *   delegated:   { sub: <delegator>, act: { sub: <actor> } }        (RFC 8693)
 *   grant authz: { sub: <delegator>, delegate: <actor>, scope: [...] }
 * The actor — not the delegator — is the transport identity: grants and the
 * committer check bind to whoever actually acts (M4; before this, a delegated
 * token was treated as its delegator). A scoped token additionally caps the
 * access level to its git:* scopes.
 */
export function identityFromClaims(payload: Record<string, unknown>): GitIdentity | null {
  const sub = typeof payload.email === 'string' ? payload.email : payload.sub
  if (typeof sub !== 'string' || !sub) return null
  const cap = capFromScope(payload.scope)
  const withCap = (identity: GitIdentity): GitIdentity => cap === undefined ? identity : { ...identity, cap }

  const act = payload.act
  if (act && typeof act === 'object' && typeof (act as { sub?: unknown }).sub === 'string') {
    const actor = (act as { sub: string }).sub
    return actor ? withCap({ email: actor, act: 'agent', delegator: sub }) : null
  }
  if (typeof payload.delegate === 'string' && payload.delegate) {
    return withCap({ email: payload.delegate, act: 'agent', delegator: sub })
  }
  return withCap({ email: sub, act: act === 'human' ? 'human' : 'agent' })
}
