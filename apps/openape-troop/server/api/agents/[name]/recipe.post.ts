import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../database/drizzle'
import { agents } from '../../../database/schema'
import { materializeRecipe } from '../../../utils/agent-recipe'
import { requireOwner } from '../../../utils/auth'
import { broadcastToOwner } from '../../../utils/nest-registry'
import { buildDeployPlan, fetchRecipeManifest, RECIPE_AGENT_TOOLS } from '../../../utils/recipe-deploy'

// POST /api/agents/:name/recipe — set / update the recipe on an EXISTING
// agent (INT-4). Re-fetches <repo>@<ref>'s ape-agent.yaml, re-validates
// + materializes it with the given params, and applies the resulting
// intent + toolset to the live agent (no destroy/respawn). The nest
// re-syncs within ~1s (config-update broadcast); the bridge picks up the
// new system prompt on the next run. New capability secrets are returned
// so the UI can prompt the owner to bind them (sealed) via
// /api/agents/:name/secrets/:env.
//
// This is the "iterate on a deployed agent" path: change the recipe,
// re-point the agent at the new ref, done.
const bodySchema = z.object({
  repo_ref: z.string().min(3).max(400),
  params: z.record(z.string(), z.unknown()).default({}),
})

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'name is required' })
  }
  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }

  const manifest = await fetchRecipeManifest(body.data.repo_ref, async (url) => {
    const r = await fetch(url)
    return { ok: r.ok, status: r.status, text: await r.text() }
  })
  if (!manifest.ok) throw createError({ statusCode: 400, statusMessage: manifest.reason })

  const mat = materializeRecipe(manifest.recipe, body.data.params)
  if (!mat.ok) throw createError({ statusCode: 400, statusMessage: mat.reason })

  const plan = buildDeployPlan(manifest.recipe, mat.value, { agentName: name })

  const db = useDb()
  const result = await db
    .update(agents)
    .set({ systemPrompt: plan.systemPrompt, tools: [...RECIPE_AGENT_TOOLS] })
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'agent not found' })
  }

  const agent = result[0]!
  // Re-sync the named agent on any connected nest (same path as the
  // PATCH endpoint) so the new intent lands on disk within ~1s.
  broadcastToOwner(agent.ownerEmail, { type: 'config-update', agent_email: agent.email })

  return {
    agent_name: agent.agentName,
    ref: manifest.ref,
    required_capabilities: plan.requiredCapabilities,
    schedules: plan.schedules.map(s => ({ task_id: s.taskId, cron: s.cron, name: s.name })),
  }
})
