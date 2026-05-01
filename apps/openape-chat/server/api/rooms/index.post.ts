import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { useDb } from '../../database/drizzle'
import { memberships, rooms } from '../../database/schema'
import { resolveCaller } from '../../utils/auth'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['channel', 'dm']).default('channel'),
  members: z.array(z.string().email()).default([]),
})

export default defineEventHandler(async (event) => {
  const caller = await resolveCaller(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const id = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const db = useDb()

  await db.insert(rooms).values({
    id,
    name: parsed.data.name,
    kind: parsed.data.kind,
    createdByEmail: caller.email,
    createdAt: now,
  })

  // Caller is always a member; admin role for channels, no role distinction for DMs
  // (both members are equal in DM context).
  const allMembers = new Set([caller.email, ...parsed.data.members])
  for (const email of allMembers) {
    await db.insert(memberships).values({
      roomId: id,
      userEmail: email,
      role: email === caller.email ? 'admin' : 'member',
      joinedAt: now,
    }).onConflictDoNothing()
  }

  return {
    id,
    name: parsed.data.name,
    kind: parsed.data.kind,
    createdByEmail: caller.email,
    createdAt: now,
  }
})
