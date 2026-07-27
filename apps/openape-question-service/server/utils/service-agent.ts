import type { H3Event } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

// Narrow nuxt-auth-sp's requireCaller (session cookie OR agent bearer, verified
// against the DDISA IdP) down to just the bound service-agent(s) allowed to pull
// and resolve tasks. NUXT_AGENT_SERVICE_EMAIL is a comma list so several agents
// (e.g. a /service-agent session-worker + a deployed ape-agent) can share the
// queue. Returns the agent's email, or null to deny (the handler answers 401).
export async function resolveServiceAgent(event: H3Event): Promise<string | null> {
  const allow = String(useRuntimeConfig().agentServiceEmail ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (allow.length === 0)
    return null
  try {
    const caller = await requireCaller(event)
    return allow.includes(caller.email.toLowerCase()) ? caller.email : null
  }
  catch {
    // No valid session/bearer → deny (this is the auth decision, not a swallowed bug).
    return null
  }
}
