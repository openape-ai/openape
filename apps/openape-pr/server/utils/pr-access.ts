import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { prs } from '../database/schema'
import { createProblemError } from './problem'
import type { Caller } from './require-auth'

export type PrRow = typeof prs.$inferSelect

export async function loadOwnPr(event: H3Event, caller: Caller): Promise<PrRow> {
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'PR id required' })
  const pr = await loadPrById(id)
  if (pr.createdBy !== caller.email) {
    throw createProblemError({ status: 403, title: 'Forbidden', detail: 'Only the uploader can access this PR.' })
  }
  return pr
}

export async function loadPrById(id: string): Promise<PrRow> {
  const db = useDb()
  const pr = await db.select().from(prs)
    .where(and(eq(prs.id, id), isNull(prs.deletedAt)))
    .get()
  if (!pr) throw createProblemError({ status: 404, title: 'PR not found' })
  return pr
}

export async function loadPrBySlug(slug: string): Promise<PrRow> {
  const db = useDb()
  const pr = await db.select().from(prs)
    .where(and(eq(prs.slug, slug), isNull(prs.deletedAt)))
    .get()
  if (!pr) throw createProblemError({ status: 404, title: 'PR not found' })
  return pr
}

/** Resolve a PR by slug first (agent poll), then by id (human). */
export async function loadPrBySlugOrId(handle: string): Promise<PrRow> {
  const db = useDb()
  const pr = await db.select().from(prs)
    .where(and(eq(prs.slug, handle), isNull(prs.deletedAt)))
    .get()
  if (pr) return pr
  return loadPrById(handle)
}

export function reviewUrl(event: H3Event, id: string): string {
  const configured = (useRuntimeConfig().publicUrl as string)?.replace(/\/$/, '')
  const base = configured || getRequestURL(event).origin
  return `${base}/prs/${id}`
}
