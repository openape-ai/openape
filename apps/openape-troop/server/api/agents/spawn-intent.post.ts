import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { listNestPeersForOwner } from '../../utils/nest-registry'
import { createSpawnIntent } from '../../utils/spawn-intents'
import { requireOwner } from '../../utils/auth'

// POST /api/agents/spawn-intent — owner-side request to spawn a new
// agent on one of their connected Macs. Returns immediately with
// an intent_id; the actual spawn runs on the nest, gated by the
// usual DDISA-grant approval flow (Patrick taps Approve on iPhone).
//
// The endpoint doesn't hold the HTTP connection open for that window
// (could be minutes if Patrick is away from his phone). The UI polls
// `/api/agents/spawn-intent/:id` until result lands, or until the
// owner gives up — the intent map auto-prunes after 30min either way.

const AGENT_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/

const bodySchema = z.object({
  name: z.string().regex(AGENT_NAME_REGEX, 'name must match /^[a-z][a-z0-9-]{0,23}$/'),
  // Optional: if the owner has multiple Macs connected, pick one.
  // Omitted = first connected nest.
  host_id: z.string().optional(),
  bridge_key: z.string().optional(),
  bridge_base_url: z.string().url().optional(),
  bridge_model: z.string().optional(),
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

  const intentId = randomUUID()
  createSpawnIntent(intentId)

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
  }
})
