import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import toolCatalog from '../../tool-catalog.json'
import { useDb } from '../../database/drizzle'
import { agents } from '../../database/schema'
import { requireOwner } from '../../utils/auth'

const KNOWN_TOOL_NAMES = new Set<string>(
  (toolCatalog as { tools: Array<{ name: string }> }).tools.map(t => t.name),
)

// Update agent-level metadata that the owner is allowed to edit.
// `systemPrompt` and `tools` whitelist — host-id / hostname / pubkey
// are agent-side state set on first sync and shouldn't be
// owner-mutable. Add fields here as the owner-facing surface grows.
const bodySchema = z.object({
  system_prompt: z.string().max(8000).optional(),
  tools: z.array(z.string()).optional().refine(
    arr => arr === undefined || arr.every(t => KNOWN_TOOL_NAMES.has(t)),
    { message: 'tools list contains unknown tool names — see /api/tool-catalog' },
  ),
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
  if (Object.keys(body.data).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'no fields to update' })
  }

  const db = useDb()
  const updates: Record<string, unknown> = {}
  if (body.data.system_prompt !== undefined) updates.systemPrompt = body.data.system_prompt
  if (body.data.tools !== undefined) updates.tools = body.data.tools

  const result = await db
    .update(agents)
    .set(updates)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'agent not found' })
  }
  return result[0]
})
