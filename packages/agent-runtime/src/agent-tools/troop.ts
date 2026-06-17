import type { ToolDefinition } from './index.js'
import { getAuthorizedBearer } from '@openape/cli-auth'

// Read-only access to the agent's troop company (objectives, reports, members,
// cost-snapshots, overview). Unlike http.get (which strips Authorization), this
// tool authenticates as the agent itself via its own DDISA token — the gateway
// authorizes a member agent to read its owner's company.

const TROOP = 'https://troop.openape.ai'
const RESOURCES = ['objectives', 'reports', 'members', 'cost-snapshots', 'overview'] as const
type Resource = (typeof RESOURCES)[number]

function pathFor(resource: Resource, orgId: string): string {
  const id = encodeURIComponent(orgId)
  return resource === 'overview' ? `/api/orgs/${id}` : `/api/orgs/${id}/${resource}`
}

const OBJECTIVE_STATUS = ['planned', 'in_progress', 'done', 'abandoned'] as const

export const troopTools: ToolDefinition[] = [
  {
    name: 'troop.company.read',
    description:
      'Read your troop company data on troop.openape.ai. resource: objectives | reports | members | cost-snapshots | overview (vision+budget). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: [...RESOURCES], description: 'Which company resource to read.' },
        org_id: { type: 'string', description: 'Your company (org) id.' },
      },
      required: ['resource', 'org_id'],
    },
    execute: async (args: unknown) => {
      const { resource, org_id } = (args ?? {}) as { resource?: string, org_id?: string }
      if (!resource || !RESOURCES.includes(resource as Resource)) {
        throw new Error(`troop.company.read: unknown resource '${resource}' (expected ${RESOURCES.join(' | ')})`)
      }
      if (!org_id) throw new Error('troop.company.read: org_id is required')
      const bearer = await getAuthorizedBearer({ endpoint: TROOP, aud: 'troop.openape.ai' })
      const res = await fetch(`${TROOP}${pathFor(resource as Resource, org_id)}`, {
        headers: { authorization: bearer },
      })
      if (!res.ok) {
        throw new Error(`troop.company.read ${resource} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      return JSON.stringify(await res.json())
    },
  },
  {
    name: 'troop.objective.upsert',
    description:
      'Create or update a company objective on troop.openape.ai. Pass objective_id to update an existing one; omit it to create. Authenticated as the agent (acting for the owner).',
    parameters: {
      type: 'object',
      properties: {
        org_id: { type: 'string', description: 'Your company (org) id.' },
        objective_id: { type: 'string', description: 'Omit to create; pass to update an existing objective.' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: [...OBJECTIVE_STATUS] },
        target_date: { type: 'number', description: 'Unix seconds, or null to clear.' },
      },
      required: ['org_id'],
    },
    execute: async (args: unknown) => {
      const a = (args ?? {}) as { org_id?: string, objective_id?: string, title?: string, description?: string, status?: string, target_date?: number }
      if (!a.org_id) throw new Error('troop.objective.upsert: org_id is required')
      if (a.status && !OBJECTIVE_STATUS.includes(a.status as typeof OBJECTIVE_STATUS[number])) {
        throw new Error(`troop.objective.upsert: bad status '${a.status}'`)
      }
      if (!a.objective_id && !a.title) throw new Error('troop.objective.upsert: title is required to create an objective')
      const bearer = await getAuthorizedBearer({ endpoint: TROOP, aud: 'troop.openape.ai' })
      const id = encodeURIComponent(a.org_id)
      const body: Record<string, unknown> = {}
      if (a.title !== undefined) body.title = a.title
      if (a.description !== undefined) body.description = a.description
      if (a.status !== undefined) body.status = a.status
      if (a.target_date !== undefined) body.target_date = a.target_date
      const url = a.objective_id
        ? `${TROOP}/api/orgs/${id}/objectives/${encodeURIComponent(a.objective_id)}`
        : `${TROOP}/api/orgs/${id}/objectives`
      const res = await fetch(url, {
        method: a.objective_id ? 'PATCH' : 'POST',
        headers: { authorization: bearer, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`troop.objective.upsert → ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      return JSON.stringify(await res.json())
    },
  },
]
