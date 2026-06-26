import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { runs } from '../database/schema'
import { createProblemError } from './problem'
import type { Caller } from './require-auth'

export type RunRow = typeof runs.$inferSelect

export async function loadOwnRun(event: H3Event, caller: Caller): Promise<RunRow> {
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Run id required' })
  const db = useDb()
  const run = await db.select().from(runs)
    .where(and(eq(runs.id, id), isNull(runs.deletedAt)))
    .get()
  if (!run) throw createProblemError({ status: 404, title: 'Run not found' })
  if (run.createdBy !== caller.email) {
    throw createProblemError({ status: 403, title: 'Forbidden', detail: 'Only the uploader can access this run via the authenticated API. Use the public share link instead.' })
  }
  return run
}

export async function loadRunBySlug(slug: string): Promise<RunRow> {
  const db = useDb()
  const run = await db.select().from(runs)
    .where(and(eq(runs.slug, slug), isNull(runs.deletedAt)))
    .get()
  if (!run) throw createProblemError({ status: 404, title: 'Run not found' })
  return run
}

export function publicRunUrl(event: H3Event, slug: string): string {
  const configured = (useRuntimeConfig().publicUrl as string)?.replace(/\/$/, '')
  const base = configured || getRequestURL(event).origin
  return `${base}/r/${slug}`
}
