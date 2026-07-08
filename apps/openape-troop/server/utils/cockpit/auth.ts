import { createError  } from 'h3'
import type { H3Event } from 'h3'

function allowlist(): string[] {
  return String(process.env.NUXT_AGENT_SERVICE_EMAIL ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

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

// The bound service-agent (CEO brain) — DDISA-verified caller, restricted to the allowlist.
export async function requireCockpitAgent(event: H3Event): Promise<string> {
  const caller = await requireCaller(event)
  const email = caller.email.toLowerCase()
  const allow = allowlist()
  if (allow.length === 0 || !allow.includes(email))
    throw createError({ statusCode: 403, statusMessage: 'not an allowed service agent' })
  return caller.email
}
