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

// The serving agent (CEO brain): any DDISA-verified identity. No allowlist — the
// queue is owner-bound, so a caller only ever claims/resolves its OWN owner's tasks.
// That scoping (not an allowlist) is the multi-user security boundary.
export async function requireCockpitAgent(event: H3Event): Promise<string> {
  const caller = await requireCaller(event)
  return caller.email
}
