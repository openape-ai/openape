import { createHash } from 'node:crypto'

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'agent'
}

// Hash-suffixed agent emails (#294).
//
// The historical derivation collapsed dots in the owner's domain
// (`replace(/\./g, '_')`) and joined with `+`, so two distinct owners
// could collide: `foo@example.com` and `foo@example_com` both produced
// `…+foo+example_com@<host>`. Same for sanitised names where "Owner" and
// "o-w-n-e-r" both flatten to `owner`. First-write-wins 409s the second
// user, but the agent email then misleadingly suggests the wrong owner.
// Worse, an attacker who pre-enrols a colliding agent can later claim the
// agent's identity belongs to them.
//
// Suffixing a short hash of the canonical owner email makes collisions
// statistically improbable while staying readable. 8 hex chars = 32 bits
// of entropy — at our scale (single-digit-thousands of agents per owner
// at most) the birthday-collision risk is negligible, and across owners
// the hash is fully owner-scoped so cross-owner collisions are
// structurally impossible.
function ownerHash(ownerEmail: string): string {
  return createHash('sha256').update(ownerEmail.trim().toLowerCase()).digest('hex').slice(0, 8)
}

/**
 * Derive an agent's email address.
 *
 * The domain is the **issuing IdP's host** so the agent identity is
 * DDISA-discoverable back to the IdP that can actually authenticate it.
 * It used to be the hardcoded literal `id.openape.ai`, which was only
 * correct for the flagship: any other instance (id.openape.at, a
 * self-hosted IdP, the local test stack) minted agents under a domain
 * that didn't match their own issuer.
 */
export function deriveAgentEmail(ownerEmail: string, agentName: string, issuerHost: string): string {
  const [local, domain] = ownerEmail.split('@')
  const safeName = sanitizeName(agentName)
  return `${safeName}-${ownerHash(ownerEmail)}+${local}+${domain!.replace(/\./g, '_')}@${issuerHost}`
}
