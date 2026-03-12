import type { Org } from './org-store'

export function checkUserLimit(org: Org, currentCount: number): void {
  if (currentCount >= org.limits.maxUsers) {
    throw createError({
      statusCode: 403,
      statusMessage: `User limit reached (${org.limits.maxUsers}). Upgrade to add more users.`,
    })
  }
}

export function checkAgentLimit(org: Org, currentCount: number): void {
  if (currentCount >= org.limits.maxAgents) {
    throw createError({
      statusCode: 403,
      statusMessage: `Agent limit reached (${org.limits.maxAgents}). Upgrade to add more agents.`,
    })
  }
}
