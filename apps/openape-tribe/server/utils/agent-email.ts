// Agent emails follow the DDISA convention used by `apes agents
// enroll`:
//
//   agent+<agentName>+<ownerDomain>@id.openape.ai
//
// The name and owner-domain are recoverable so we don't need a
// separate lookup at every API hit. Owner email itself is then
// `<owner-local>@<owner-domain>` — we know the domain from the agent
// email but the local-part lives only in the IdP's user store, so
// `ownerEmail` is whatever the agent posts on its first sync (it
// knows because it was provisioned by that very owner). For owner-
// auth endpoints we read the owner email directly from the session
// instead.

export interface ParsedAgentEmail {
  agentName: string
  ownerDomain: string
}

const AGENT_EMAIL_RE = /^agent\+([a-z0-9-]+)\+([^@]+)@([^@]+)$/

export function parseAgentEmail(email: string): ParsedAgentEmail | null {
  const m = email.toLowerCase().match(AGENT_EMAIL_RE)
  if (!m) return null
  return {
    agentName: m[1]!,
    ownerDomain: m[2]!.replace(/_/g, '.'),
  }
}
