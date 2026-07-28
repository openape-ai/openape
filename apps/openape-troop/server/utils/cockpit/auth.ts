import type { H3Event } from 'h3'
import { createError } from 'h3'

// The logged-in owner (troop session or CLI/agent bearer via requireCaller). In dev
// without a session, COCKPIT_DEV_OWNER lets us exercise the flow without the
// interactive IdP login (localhost redirect can't complete against the prod IdP).
export async function cockpitOwner(event: H3Event): Promise<string> {
  try {
    const caller = await requireCaller(event)
    if (caller?.email) return caller.email
  }
  catch { /* not authenticated */ }
  if (import.meta.dev && process.env.COCKPIT_DEV_OWNER) return process.env.COCKPIT_DEV_OWNER
  throw createError({ statusCode: 401, statusMessage: 'login required' })
}

// The delegation scope a scope-bounded caller needs to serve the cockpit queue
// (#1033 — the Operator identity). Must match the catalog entry in
// utils/scope-catalog.ts, which feeds well-known discovery and the exchange.
export const COCKPIT_SERVE_SCOPE = 'troop:cockpit-serve'

// The serving agent (Operator brain): any DDISA-verified identity. No allowlist — the
// queue is owner-bound, so a caller only ever claims/resolves its OWN owner's tasks.
// That scoping (not an allowlist) is the multi-user security boundary.
//
// Delegated callers (their token carries a `scope` claim) additionally need
// `troop:cockpit-serve` in that scope: a delegation minted for e.g. agent
// management must not be able to drain the owner's cockpit queue. First-party
// callers have no scope claim and pass unchanged.
export async function requireCockpitAgent(event: H3Event): Promise<string> {
  const caller = await requireCaller(event)
  if (caller.scope && !caller.scope.includes(COCKPIT_SERVE_SCOPE)) {
    throw createError({
      statusCode: 403,
      statusMessage: `scope '${COCKPIT_SERVE_SCOPE}' required (token carries: ${caller.scope.join(', ') || 'none'})`,
    })
  }
  return caller.email
}
