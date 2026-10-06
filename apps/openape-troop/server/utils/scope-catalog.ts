// troop's scope catalog per openape-ai/protocol sp-data-access.md §3.
//
// Published at /.well-known/openape.json#scopes so any Receiver SP
// can discover what they can request a
// delegation for. Each entry is {id, description, grants[]} —
// `description` is rendered verbatim on the IdP consent screen the
// Owner sees, so write it plainly.
//
// Adding a new scope:
//   1. Define it here, listing every route it authorizes under `grants`
//   2. Gate the route handlers that should require it via
//      requireOwnerWithScope (utils/auth.ts)
//   3. No client/SP-side registration needed — Receivers discover
//      via /.well-known/openape.json
//
// Adding a new ROUTE an existing delegation must reach: add it to that
// scope's `grants`. Every auth helper now runs the same route-precise
// check, so a route absent from the catalog is 403 for delegated tokens
// (the yolo-sync incident, #1117).
//
// IDs use the convention `<sp-shortname>:<action>` from the spec.

export interface TroopScope {
  id: string
  description: string
  /**
   * The routes this scope authorizes, as `METHOD /path` with `:param`
   *  placeholders. ENFORCED: a scope-bounded token reaching any route not
   *  named here gets a 403. A route missing from this list is therefore
   *  closed to delegation, not open — add the grant when a delegation
   *  should reach it.
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
    id: 'troop:pause-agent',
    description: 'Pause and resume agents (and whole nests) on this troop on the user\'s behalf. A paused agent stays enrolled but runs no LLM turns — reversible any time.',
    grants: ['POST /api/agents/:name/pause', 'POST /api/agents/:name/resume', 'POST /api/nests/:host_id/pause', 'POST /api/nests/:host_id/resume'],
  },
  {
    id: 'troop:read-agents',
    description: 'Read the user\'s agent list, agent details, and live nest-status on this troop.',
    grants: ['GET /api/agents', 'GET /api/agents/:name', 'GET /api/nest/hosts'],
  },
  {
    id: 'troop:cockpit-serve',
    description: 'Claim and resolve the owner\'s cockpit tasks (companies and services) as their operator, read the org context (tree, objectives, reports) and post reports. Does not include agent or nest management.',
    grants: [
      // Serving a company includes knowing it: org tree, objectives and
      // reports are the operator's working context; posting reports is how
      // it reports back (#1262). Handlers derive the owner from the
      // delegated sub, so these stay owner-bound like the queue.
      'GET /api/cockpit/orgs/:orgId/tree',
      'GET /api/orgs/:id/objectives',
      'GET /api/orgs/:id/reports',
      'POST /api/orgs/:id/reports',
      // Serving the owner's services starts with discovering them (#1075) —
      // without this the worker's service loop only ever sees an empty list.
      'GET /api/cockpit/services',
      'POST /api/cockpit/agent/tasks/next',
      'POST /api/cockpit/agent/tasks/resolve',
      'POST /api/cockpit/agent/heartbeat',
      'POST /api/cockpit/agent/yolo-sync',
      'POST /api/cockpit/agent/automations',
      'GET /api/cockpit/agent/doctor',
      'POST /api/cockpit/agent/files',
      'GET /api/cockpit/agent/files/:id',
      'GET /api/cockpit/agent/memory/:id',
      'GET /api/cockpit/agent/skill/:id',
    ],
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
