import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../database/drizzle'
import { runs } from '../database/schema'
import { createProblemError } from './problem'
import type { Caller } from '@openape/nuxt-auth-sp'

export type RunRow = typeof runs.$inferSelect

export async function loadOwnRun(event: H3Event, caller: Caller): Promise<RunRow> {
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Run id required' })
  const db = useDb()
  const run = await db.select().from(runs).where(and(eq(runs.id, id), isNull(runs.deletedAt))).get()
  if (!run) throw createProblemError({ status: 404, title: 'Run not found' })
  if (run.createdBy !== caller.email) {
    throw createProblemError({ status: 403, title: 'Forbidden', detail: 'Only the uploader can access this run via the authenticated API. Use the public share link instead.' })
  }
  return run
}

export async function loadRunBySlug(slug: string): Promise<RunRow> {
  const db = useDb()
  const run = await db.select().from(runs).where(and(eq(runs.slug, slug), isNull(runs.deletedAt))).get()
  if (!run) throw createProblemError({ status: 404, title: 'Run not found' })
  return run
}

/**
 * Version requested via ?v=<n> on a public run route, defaulting to the
 * run's current version. 400 on malformed input, 404 on unknown versions.
 */
export function requestedVersion(event: H3Event, run: RunRow): number {
  const raw = getQuery(event).v
  if (raw === undefined) return run.version
  const version = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isInteger(version) || version < 1) {
    throw createProblemError({ status: 400, title: 'Invalid version', detail: '"v" must be a positive integer.' })
  }
  if (version > run.version) throw createProblemError({ status: 404, title: 'Version not found' })
  return version
}

export function publicRunUrl(event: H3Event, slug: string): string {
  const configured = (useRuntimeConfig().publicUrl as string)?.replace(/\/$/, '')
  const base = configured || getRequestURL(event).origin
  return `${base}/r/${slug}`
}
