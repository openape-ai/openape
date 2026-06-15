import { z } from 'zod'
import { parseAgentEmail } from '../../utils/agent-email'
import { requireOwnerWithScope } from '../../utils/auth'
import { dispatchSpawnIntent } from '../../utils/spawn-dispatch'

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
  // Reasoning/thinking depth for gpt-5.x — lets the PM-orchestrator tier
  // compute by task difficulty (quick-win=low, research=high) on one model.
  bridge_reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
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
  // Scope-gate: first-party (session / aud=apes-cli Bearer) auto-passes.
  // Delegated callers (Receiver SPs) need `troop:spawn-agent` in their
  // CLI token, minted at /api/cli/exchange per sp-data-access.md.
  const { owner: caller } = await requireOwnerWithScope(event, 'troop:spawn-agent')
  // An agent dispatching workers (act=agent — e.g. the PM-orchestrator) carries
  // its OWN email as the caller, but nests + stashed deploys are keyed under the
  // HUMAN owner. Normalize so an agent's spawn targets its owner's nest; a human
  // caller's email isn't an agent email so parseAgentEmail returns null (no-op).
  const owner = parseAgentEmail(caller)?.ownerEmail ?? caller
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'invalid body' })
  }

  const r = await dispatchSpawnIntent(owner, {
    name: parsed.data.name,
    hostId: parsed.data.host_id,
    systemPrompt: parsed.data.system_prompt,
    bridge: {
      key: parsed.data.bridge_key,
      baseUrl: parsed.data.bridge_base_url,
      model: parsed.data.bridge_model,
      reasoningEffort: parsed.data.bridge_reasoning_effort,
    },
    recipe: parsed.data.recipe ? { repoRef: parsed.data.recipe.repo_ref, params: parsed.data.recipe.params } : undefined,
  })

  return {
    intent_id: r.intentId,
    host_id: r.hostId,
    hostname: r.hostname,
    ...(r.ref ? { ref: r.ref } : {}),
    required_capabilities: r.requiredCapabilities,
    schedules: r.schedules,
  }
})
