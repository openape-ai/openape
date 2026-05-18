import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { materializeRecipe } from '../../utils/agent-recipe'
import { requireOwner } from '../../utils/auth'
import { listNestPeersForOwner } from '../../utils/nest-registry'
import { buildDeployPlan, fetchRecipeManifest } from '../../utils/recipe-deploy'
import { stashRecipeDeploy } from '../../utils/recipe-deploys'
import { createSpawnIntent } from '../../utils/spawn-intents'

// POST /api/agents/spawn-intent — owner-side request to spawn a new
// agent on one of their connected Macs. Returns immediately with
// an intent_id; the actual spawn runs on the nest, gated by the
// usual DDISA-grant approval flow (Patrick taps Approve on iPhone).
//
// One extensible flow, no special-casing: every spawn has a name and
// (optionally) a system prompt. A recipe is purely *additive* — when
// `recipe` is given, the recipe intent becomes the agent's base
// system prompt + its schedules/capabilities are folded in, and the
// owner's own `system_prompt` rides along as the user_addendum (M5).
// The post-spawn config is stashed and applied by the `spawn-result`
// handler (nest-ws.ts) so there's no second round-trip / PATCH race.

const AGENT_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/

const bodySchema = z.object({
  name: z.string().regex(AGENT_NAME_REGEX, 'name must match /^[a-z][a-z0-9-]{0,23}$/'),
  // Optional: if the owner has multiple Macs connected, pick one.
  // Omitted = first connected nest.
  host_id: z.string().optional(),
  bridge_key: z.string().optional(),
  bridge_base_url: z.string().url().optional(),
  bridge_model: z.string().optional(),
  // Free-text persona/behaviour the owner typed. Without a recipe it
  // is the agent's system prompt; with a recipe it is the additive
  // user_addendum on top of the recipe intent.
  system_prompt: z.string().max(32_000).optional(),
  // Optional recipe overlay — additive, not a mode.
  recipe: z.object({
    repo_ref: z.string().min(3).max(400),
    params: z.record(z.string(), z.unknown()).default({}),
  }).optional(),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  const peers = listNestPeersForOwner(owner)
  if (peers.length === 0) {
    throw createError({
      statusCode: 503,
      statusMessage: 'no connected nest — make sure the nest daemon is running on the host where you want this agent. The legacy `apes nest spawn` CLI path still works as a fallback.',
    })
  }
  const target = parsed.data.host_id
    ? peers.find(p => p.hostId === parsed.data.host_id)
    : peers[0]
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: `no nest found for host_id ${parsed.data.host_id}` })
  }

  // Resolve an optional recipe overlay before we publish the intent so
  // a bad repo_ref / manifest fails fast (before the grant prompt).
  let requiredCapabilities: string[] = []
  let schedules: Array<{ task_id: string, cron: string, name: string }> = []
  let recipeRef: string | undefined
  let plan: ReturnType<typeof buildDeployPlan> | null = null

  if (parsed.data.recipe) {
    const manifest = await fetchRecipeManifest(parsed.data.recipe.repo_ref, async (url) => {
      const r = await fetch(url)
      return { ok: r.ok, status: r.status, text: await r.text() }
    })
    if (!manifest.ok) throw createError({ statusCode: 400, statusMessage: manifest.reason })
    const mat = materializeRecipe(manifest.recipe, parsed.data.recipe.params)
    if (!mat.ok) throw createError({ statusCode: 400, statusMessage: mat.reason })
    plan = buildDeployPlan(manifest.recipe, mat.value, {
      agentName: parsed.data.name,
      userAddendum: parsed.data.system_prompt,
    })
    requiredCapabilities = plan.requiredCapabilities
    schedules = plan.schedules.map(s => ({ task_id: s.taskId, cron: s.cron, name: s.name }))
    recipeRef = manifest.ref
  }
  else if (parsed.data.system_prompt) {
    // No recipe — still apply the owner's system prompt server-side so
    // the dialog never has to do a follow-up PATCH.
    plan = {
      agentName: parsed.data.name,
      systemPrompt: parsed.data.system_prompt,
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
    name: parsed.data.name,
    bridge: {
      key: parsed.data.bridge_key,
      base_url: parsed.data.bridge_base_url,
      model: parsed.data.bridge_model,
    },
  })
  if (!ok) {
    throw createError({ statusCode: 503, statusMessage: 'nest dropped before intent was delivered — retry in a few seconds' })
  }

  return {
    intent_id: intentId,
    host_id: target.hostId,
    hostname: target.hostname,
    ...(recipeRef ? { ref: recipeRef } : {}),
    required_capabilities: requiredCapabilities,
    schedules,
  }
})
