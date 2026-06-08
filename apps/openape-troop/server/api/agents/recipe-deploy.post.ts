import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { materializeRecipe } from '../../utils/agent-recipe'
import { requireOwner } from '../../utils/auth'
import { listNestPeersForOwner } from '../../utils/nest-registry'
import { buildDeployPlan, fetchRecipeManifest } from '../../utils/recipe-deploy'
import { stashRecipeDeploy } from '../../utils/recipe-deploys'
import { createSpawnIntent } from '../../utils/spawn-intents'

// POST /api/agents/recipe-deploy — one-step deploy of an Agent Recipe.
// Fetches <repo>@<ref>'s ape-agent.yaml (ref-pin enforced), validates
// it + the supplied params (M1), spawns the agent (existing intent
// flow), and stashes the deploy plan so spawn-result applies the
// system prompt + schedules. Capability secrets are bound separately
// by the owner via /api/agents/:name/secrets/:env (M2c) — the response
// lists which envs are required.
const bodySchema = z.object({
  repo_ref: z.string().min(3).max(400),
  params: z.record(z.string(), z.unknown()).default({}),
  host_id: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  const manifest = await fetchRecipeManifest(parsed.data.repo_ref, async (url) => {
    const r = await fetch(url)
    return { ok: r.ok, status: r.status, text: await r.text() }
  })
  if (!manifest.ok) throw createError({ statusCode: 400, statusMessage: manifest.reason })

  const mat = materializeRecipe(manifest.recipe, parsed.data.params)
  if (!mat.ok) throw createError({ statusCode: 400, statusMessage: mat.reason })

  const plan = buildDeployPlan(manifest.recipe, mat.value, { recipeRef: parsed.data.repo_ref })

  const peers = listNestPeersForOwner(owner)
  if (peers.length === 0) {
    throw createError({ statusCode: 503, statusMessage: 'no connected nest — start the nest daemon on the target host' })
  }
  const target = parsed.data.host_id ? peers.find(p => p.hostId === parsed.data.host_id) : peers[0]
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: `no nest found for host_id ${parsed.data.host_id}` })
  }

  const intentId = randomUUID()
  createSpawnIntent(intentId)
  stashRecipeDeploy(intentId, owner.toLowerCase(), plan)

  const ok = target.send({ type: 'spawn-intent', intent_id: intentId, name: plan.agentName })
  if (!ok) {
    throw createError({ statusCode: 503, statusMessage: 'nest dropped before intent was delivered — retry shortly' })
  }

  return {
    intent_id: intentId,
    agent_name: plan.agentName,
    ref: manifest.ref,
    required_capabilities: plan.requiredCapabilities,
    schedules: plan.schedules.map(s => ({ task_id: s.taskId, cron: s.cron, name: s.name })),
  }
})
