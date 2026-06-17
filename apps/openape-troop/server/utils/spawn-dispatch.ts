import { randomUUID } from 'node:crypto'
import { materializeRecipe } from './agent-recipe'
import { listNestPeersForOwner } from './nest-registry'
import { buildDeployPlan, fetchRecipeManifest, RECIPE_AGENT_TOOLS } from './recipe-deploy'
import { stashRecipeDeploy } from './recipe-deploys'
import { createSpawnIntent } from './spawn-intents'

// Shared spawn-intent dispatch. Both the machine-surface endpoint
// (POST /api/agents/spawn-intent) and the org member spawn (B0 merge,
// POST /api/orgs/:id/members/:email/spawn) publish a spawn-intent to a
// connected nest the same way — extracting it here keeps that one flow in
// one place. Returns immediately with an intent_id the caller polls.

export interface SpawnDispatchOptions {
  /** Agent slug, /^[a-z][a-z0-9-]{0,23}$/. */
  name: string
  /** Pick a specific connected nest; omitted = first. */
  hostId?: string
  bridge?: {
    key?: string
    baseUrl?: string
    model?: string
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  }
  /** Owner free-text persona — system prompt without a recipe, user_addendum with one. */
  systemPrompt?: string
  /** Additive recipe overlay. */
  recipe?: { repoRef: string, params: Record<string, unknown> }
}

export interface SpawnDispatchResult {
  intentId: string
  hostId: string
  hostname: string
  ref?: string
  requiredCapabilities: string[]
  schedules: Array<{ task_id: string, cron: string, name: string }>
}

export async function dispatchSpawnIntent(owner: string, opts: SpawnDispatchOptions): Promise<SpawnDispatchResult> {
  const peers = listNestPeersForOwner(owner)
  if (peers.length === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'no connected nest — make sure the nest daemon is running on the host where you want this agent. The legacy `apes nest spawn` CLI path still works as a fallback.',
    })
  }
  const target = opts.hostId ? peers.find(p => p.hostId === opts.hostId) : peers[0]
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: `no nest found for host_id ${opts.hostId}` })
  }

  // Resolve an optional recipe overlay before publishing so a bad
  // repo_ref / manifest fails fast (before the grant prompt).
  let requiredCapabilities: string[] = []
  let schedules: Array<{ task_id: string, cron: string, name: string }> = []
  let recipeRef: string | undefined
  let plan: ReturnType<typeof buildDeployPlan> | null = null

  if (opts.recipe) {
    const manifest = await fetchRecipeManifest(opts.recipe.repoRef, async (url) => {
      const r = await fetch(url)
      return { ok: r.ok, status: r.status, text: await r.text() }
    })
    if (!manifest.ok) throw createError({ statusCode: 400, statusMessage: manifest.reason })
    const mat = materializeRecipe(manifest.recipe, opts.recipe.params)
    if (!mat.ok) throw createError({ statusCode: 400, statusMessage: mat.reason })
    plan = buildDeployPlan(manifest.recipe, mat.value, {
      agentName: opts.name,
      userAddendum: opts.systemPrompt,
    })
    requiredCapabilities = plan.requiredCapabilities
    schedules = plan.schedules.map(s => ({ task_id: s.taskId, cron: s.cron, name: s.name }))
    recipeRef = manifest.ref
  }
  else if (opts.systemPrompt) {
    plan = {
      agentName: opts.name,
      systemPrompt: opts.systemPrompt,
      tools: [...RECIPE_AGENT_TOOLS],
      schedules: [],
      requiredCapabilities: [],
    }
  }

  const intentId = randomUUID()
  createSpawnIntent(intentId)
  if (plan) stashRecipeDeploy(intentId, owner.toLowerCase(), plan)

  const ok = target.send({
    type: 'spawn-intent',
    intent_id: intentId,
    name: opts.name,
    bridge: {
      key: opts.bridge?.key,
      base_url: opts.bridge?.baseUrl,
      model: opts.bridge?.model,
      reasoning_effort: opts.bridge?.reasoningEffort,
    },
  })
  if (!ok) {
    throw createError({ statusCode: 503, statusMessage: 'nest dropped before intent was delivered — retry in a few seconds' })
  }

  return {
    intentId,
    hostId: target.hostId,
    hostname: target.hostname,
    ...(recipeRef ? { ref: recipeRef } : {}),
    requiredCapabilities,
    schedules,
  }
}
