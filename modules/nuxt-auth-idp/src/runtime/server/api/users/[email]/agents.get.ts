import type { GrantStatus, OpenApeGrant } from '@openape/core'
import { isStandingGrantRequest } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

/**
 * GET /api/users/:email/agents
 *
 * Aggregated view of all agents owned by the given user. Returns per-agent:
 *   - standing_grants: approved standing grants where agent = delegate
 *   - recent_grants: last 20 non-standing grants (requester = agent)
 *   - grant_counts: per-status tally across all non-standing grants
 *
 * Phase 1 is self-service only (caller must equal :email). Admin-on-behalf
 * access lands in a later phase.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireAuth(event)
  const email = decodeURIComponent(getRouterParam(event, 'email') ?? '')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Missing email' })
  }
  if (caller !== email) {
    throw createProblemError({ status: 403, title: 'Forbidden' })
  }

  const { userStore } = useIdpStores()
  const { grantStore } = useGrantStores()
  const agents = await userStore.findByOwner(email)

  return await Promise.all(agents.map(async (agent) => {
    // Standing grants are stored with requester=delegate (see
    // standing-grants/index.post.ts), so findByRequester(agent.email)
    // returns both normal agent grants AND standing grants that apply.
    // Split them by `type`.
    const allAgentGrants = await grantStore.findByRequester(agent.email)
    const nonStanding: OpenApeGrant[] = []
    const standingForAgent: OpenApeGrant[] = []
    for (const g of allAgentGrants) {
      if (g.type === 'standing') {
        if (!isStandingGrantRequest(g.request)) continue
        if (g.request.owner !== email) continue // only list standing grants this user created
        if (g.status !== 'approved') continue
        standingForAgent.push(g)
      }
      else {
        nonStanding.push(g)
      }
    }

    const counts: Record<GrantStatus, number> = {
      pending: 0, approved: 0, denied: 0, revoked: 0, expired: 0, used: 0,
    }
    for (const g of nonStanding) {
      counts[g.status] = (counts[g.status] ?? 0) + 1
    }
    const recent = nonStanding.toSorted((a, b) => b.created_at - a.created_at).slice(0, 20)

    return {
      email: agent.email,
      display_name: agent.name,
      standing_grants: standingForAgent,
      recent_grants: recent,
      grant_counts: counts,
    }
  }))
})
