import type { Caller } from '@openape/nuxt-auth-sp'
import type { H3Event } from 'h3'
import type { InferSelectModel } from 'drizzle-orm'
import { and, eq } from 'drizzle-orm'
import { getRouterParam } from 'h3'
import { useDb } from '../database/drizzle'
import { monitors } from '../database/schema'
import { createProblemError } from './problem'

export type MonitorRow = InferSelectModel<typeof monitors>

/** Load a monitor by :id, 404 if missing, 403 if not owned by the caller. */
export async function loadOwnMonitor(event: H3Event, caller: Caller): Promise<MonitorRow> {
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Monitor id required' })
  const db = useDb()
  const monitor = await db.select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.ownerEmail, caller.email))).get()
  if (!monitor) throw createProblemError({ status: 404, title: 'Monitor not found' })
  return monitor
}
