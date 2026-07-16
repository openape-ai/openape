import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { memory } from '../../../../database/schema'
import { requireCockpitAgent } from '../../../../utils/cockpit/auth'

// On-demand fetch of a reference-mode Memory doc. The serving agent (Operator brain)
// gets the body only for docs its owner owns — the same owner-bound scoping the
// task queue uses (no allowlist, ownerEmail IS the boundary). Large docs stay out
// of the prompt (index line only) and land here when the agent actually needs them.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const [doc] = await useDb().select().from(memory).where(and(eq(memory.id, id), eq(memory.ownerEmail, agent)))
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'unknown memory' })
  return { id: doc.id, title: doc.title, body: doc.body }
})
