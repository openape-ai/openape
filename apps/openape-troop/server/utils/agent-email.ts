// Agent emails follow the DDISA convention written by the IdP's
// `deriveAgentEmail`:
//
//   <agentName>-<ownerHash>+<owner-local>+<owner-domain-encoded>@<idp>
//
// (e.g. `igor4-cb6bf26a+patrick+hofmann_eco@id.openape.ai`)
//
// The owner-domain has its dots replaced by underscores so the email
// stays a single subaddressed mailbox. The 8-char ownerHash suffix on
// the name disambiguates same-named agents across owners. We also
// accept the older two-segment shape (`<name>+<owner-local>+<domain>`,
// no hash) so pre-hash dogfood agents keep parsing.
//
// Owner email itself is `<owner-local>@<owner-domain>` — domain is
// recoverable from the email, local-part lives in the IdP and is
// posted by the agent on its first sync.

export interface ParsedAgentEmail {
  agentName: string
  ownerDomain: string
}

const OWNER_HASH_RE = /^(.+)-([a-f0-9]{8})$/

export function parseAgentEmail(email: string): ParsedAgentEmail | null {
  const lower = email.toLowerCase()
  const atIdx = lower.lastIndexOf('@')
  if (atIdx < 0) return null
  const local = lower.slice(0, atIdx)
  const parts = local.split('+')
  // Need at least <name>+<owner-local>+<owner-domain>.
  if (parts.length < 3) return null

  const namePart = parts[0]!
  // Owner-domain is everything after the second `+`, joined back with
  // `+` in case of weird edge cases (shouldn't happen for valid
  // domains but we don't want to lose data).
  const ownerDomain = parts.slice(2).join('+').replace(/_/g, '.')
  if (!ownerDomain || !namePart) return null

  // Strip the 8-char ownerHash suffix if present so the stored
  // agentName matches what the user typed.
  const m = namePart.match(OWNER_HASH_RE)
  const agentName = m ? m[1]! : namePart

  return { agentName, ownerDomain }
}
