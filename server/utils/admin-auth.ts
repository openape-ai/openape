import type { H3Event } from 'h3'
import { createError, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { eq } from 'drizzle-orm'
import { useDb } from './db'
import { organizations } from '../database/schema'

export async function requireAdmin(event: H3Event) {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: 'openape-sp',
    password: (config as any).openapeSp.sessionSecret,
  })
  const claims = session.data.claims

  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  // Find or create org for this user
  const db = useDb()
  let org = await db
    .select()
    .from(organizations)
    .where(eq(organizations.openapeSubject, claims.sub))
    .get()

  if (!org) {
    const id = crypto.randomUUID()
    const now = new Date()
    await db.insert(organizations).values({
      id,
      name: `${claims.sub}'s Organization`,
      openapeSubject: claims.sub,
      createdAt: now,
    })
    org = await db.select().from(organizations).where(eq(organizations.id, id)).get()
  }

  return { claims, org: org! }
}
