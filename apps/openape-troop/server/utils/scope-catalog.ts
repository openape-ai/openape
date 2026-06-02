// troop's scope catalog per openape-ai/protocol sp-data-access.md §3.
//
// Published at /.well-known/openape.json#scopes so any Receiver SP
// (e.g. org.openape.ai) can discover what they can request a
// delegation for. Each entry is {id, description, grants[]} —
// `description` is rendered verbatim on the IdP consent screen the
// Owner sees, so write it plainly.
//
// Adding a new scope:
//   1. Define it here
//   2. Gate the route handlers that should require it via
//      requireOwnerWithScope (utils/auth.ts)
//   3. No client/SP-side registration needed — Receivers discover
//      via /.well-known/openape.json
//
// IDs use the convention `<sp-shortname>:<action>` from the spec.

export interface TroopScope {
  id: string
  description: string
  /**
   * Informative — the routes this scope authorizes. Used in the
   *  well-known doc + as documentation; not enforced from this list
   *  (handlers do their own requireOwnerWithScope check).
   */
  grants: string[]
}

export const TROOP_SCOPES: TroopScope[] = [
  {
    id: 'troop:spawn-agent',
    description: 'Spawn new agents on this troop on the user\'s behalf. Each spawn still requires the user\'s DDISA approval on their device — this scope only grants the right to *initiate* the flow.',
    grants: ['POST /api/agents/spawn-intent'],
  },
  {
    id: 'troop:destroy-agent',
    description: 'Destroy existing agents on this troop on the user\'s behalf. High-stakes — each destroy still triggers the user\'s DDISA approval.',
    grants: ['POST /api/agents/destroy-intent'],
  },
  {
    id: 'troop:read-agents',
    description: 'Read the user\'s agent list, agent details, and live nest-status on this troop.',
    grants: ['GET /api/agents', 'GET /api/agents/:name', 'GET /api/nest/hosts'],
  },
  {
    id: 'nest:bind',
    description: 'Bind a new device (pod) to your account on this troop. This lets the device run agents on your behalf without its own identity — you can revoke the binding any time, instantly cutting the device off.',
    grants: ['POST /api/nests/bind'],
  },
  {
    id: 'nest:spawn-agent',
    description: 'Let a bound device spawn agents under your account. The device can only create agents — it cannot destroy them or read your other devices.',
    grants: ['POST /api/agents/spawn-intent'],
  },
  {
    id: 'nest:report-status',
    description: 'Let a bound device report its status (online/offline, version) and read the list of your devices.',
    grants: ['GET /api/nests', 'GET /api/nest/hosts'],
  },
]

const KNOWN_IDS = new Set(TROOP_SCOPES.map(s => s.id))

export function isKnownScope(id: string): boolean {
  return KNOWN_IDS.has(id)
}

/** Subset check: every requested scope must be in the catalog (spec §3.2). */
export function scopesAreCovered(requested: string[]): { ok: true } | { ok: false, unknown: string[] } {
  const unknown = requested.filter(s => !KNOWN_IDS.has(s))
  return unknown.length === 0 ? { ok: true } : { ok: false, unknown }
}
