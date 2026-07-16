import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { reports } from '../../../../database/schema'
import { requireOwner } from '../../../../utils/auth'
import { newId, requireOwnedOrg } from '../../../../utils/orgs'

const Body = z.object({
  kind: z.enum(['daily', 'weekly', 'quarterly', 'alert', 'adhoc']),
  title: z.string().min(1).max(200),
  body_md: z.string().min(1).max(200_000),
})

// At v1 the Owner can hand-author reports (e.g. notes to self). When
// Operator/Sanierer Recipes land (M1+), they POST here with their own
// Bearer agent JWT and `generated_by_email` is set from that token's
// `sub`. For now we use the resolved Owner email as the author.
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const author = await requireOwner(event)
  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const id = newId()
  await useDb().insert(reports).values({
    id,
    orgId: org.id,
    kind: parsed.data.kind,
    title: parsed.data.title,
    bodyMd: parsed.data.body_md,
    generatedByEmail: author,
    createdAt: Math.floor(Date.now() / 1000),
  })
  return { id }
})
