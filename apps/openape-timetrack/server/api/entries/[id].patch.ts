import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { useDb } from '../../database/drizzle'
import { timeEntries } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'
import { resolveEntryRights } from '../../utils/visibility'
import { deriveBlock, isValidDate, parseDurationMinutes, serializeEntry, VALID_TYPE } from '../../utils/entry-shape'

/**
 * PATCH /api/entries/:id — edit. Author, project manager, or company owner.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createProblemError({ status: 400, title: 'Missing entry id' })

  const db = useDb()
  const entry = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()
  if (!entry || entry.deletedAt) throw createProblemError({ status: 404, title: 'Entry not found' })

  const ctx = await resolveProjectContext(db, entry.projectId, caller.email)
  const { canEdit } = resolveEntryRights(caller.email, { userEmail: entry.userEmail }, {
    companyRole: ctx?.companyRole,
    projectRole: ctx?.projectRole,
  })
  if (!canEdit) throw createProblemError({ status: 403, title: 'No permission to edit this entry' })

  const body = await readBody<{
    duration?: string | number
    description?: string
    type?: string
    billable?: boolean
    is_break?: boolean
    date?: string
  }>(event)

  const patch: Partial<typeof timeEntries.$inferInsert> = {}
  if (body?.duration != null) {
    const d = parseDurationMinutes(body.duration)
    if (d == null || d <= 0 || d > 24 * 60) throw createProblemError({ status: 400, title: 'invalid duration' })
    patch.durationMinutes = d
  }
  if (typeof body?.description === 'string') {
    if (body.description.length > 1000) throw createProblemError({ status: 400, title: 'description must be ≤ 1000 chars' })
    patch.description = body.description.trim()
  }
  if (body?.type != null) {
    if (!VALID_TYPE.has(body.type)) throw createProblemError({ status: 400, title: 'invalid type' })
    patch.type = body.type as 'code' | 'research' | 'planning' | 'review' | 'admin' | 'meeting'
  }
  if (typeof body?.billable === 'boolean') patch.billable = body.billable
  if (typeof body?.is_break === 'boolean') {
    patch.isBreak = body.is_break
    if (body.is_break) patch.billable = false // a break is never billable
  }
  if (typeof body?.date === 'string') {
    if (!isValidDate(body.date)) throw createProblemError({ status: 400, title: 'date must be YYYY-MM-DD' })
    patch.entryDate = body.date
  }
  if (Object.keys(patch).length === 0) throw createProblemError({ status: 400, title: 'Nothing to update' })

  // Keep von/bis consistent when duration or date changes.
  if (patch.durationMinutes != null || patch.entryDate != null) {
    const dur = patch.durationMinutes ?? entry.durationMinutes
    const date = patch.entryDate ?? entry.entryDate
    const block = deriveBlock(date, dur)
    patch.startedAt = block.startedAt
    patch.endedAt = block.endedAt
  }

  patch.updatedAt = Math.floor(Date.now() / 1000)
  patch.updatedBy = caller.email

  await db.update(timeEntries).set(patch).where(eq(timeEntries.id, id)).run()
  const row = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()
  return serializeEntry(row!)
})
