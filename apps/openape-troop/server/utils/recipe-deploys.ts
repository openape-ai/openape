import type { DeployPlan } from './recipe-deploy'

// Pending recipe-deploys keyed by spawn intent_id. POST
// /api/agents/recipe-deploy stashes the plan here, then emits a normal
// spawn-intent. When the nest's `spawn-result` lands (nest-ws.ts), the
// stored plan is applied to the new agent (system prompt + schedule
// rows). Same prune policy as spawn-intents.

interface PendingDeploy {
  createdAt: number
  ownerEmail: string
  plan: DeployPlan
}

const deploys = new Map<string, PendingDeploy>()
const PRUNE_AFTER_S = 30 * 60

function prune(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, d] of deploys) {
    if (now - d.createdAt > PRUNE_AFTER_S) deploys.delete(id)
  }
}

export function stashRecipeDeploy(intentId: string, ownerEmail: string, plan: DeployPlan): void {
  prune()
  deploys.set(intentId, { createdAt: Math.floor(Date.now() / 1000), ownerEmail, plan })
}

export function takeRecipeDeploy(intentId: string): { ownerEmail: string, plan: DeployPlan } | undefined {
  const d = deploys.get(intentId)
  if (!d) return undefined
  deploys.delete(intentId)
  return { ownerEmail: d.ownerEmail, plan: d.plan }
}

// Test-only reset — unique name (Nuxt auto-import dedupe).
export function __resetRecipeDeploysForTest(): void {
  deploys.clear()
}
