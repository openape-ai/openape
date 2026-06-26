import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { timeEntries } from '../../database/schema'
import { requireCaller } from '../../utils/require-auth'
import { createProblemError } from '../../utils/problem'
import { resolveProjectContext } from '../../utils/rbac'
import { canLogToProject } from '../../utils/visibility'
import {
  deriveBlock,
  isValidDate,
  parseDurationMinutes,
  serializeEntry,
  todayUtc,
  VALID_TYPE,
} from '../../utils/entry-shape'

interface LogBody {
  project_id?: string
  duration?: string | number
  started_at?: number
  ended_at?: number
  date?: string
  type?: string
  billable?: boolean
  is_break?: boolean
  description?: string
  created_via?: 'cli' | 'web'
}

/**
 * POST /api/entries — log a duration entry. Requires log rights on the
 * project (project member/manager or company owner; company manager NOT).
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<LogBody>(event)

  const projectId = body?.project_id?.trim()
  if (!projectId) throw createProblemError({ status: 400, title: 'project_id required' })

  const db = useDb()
  const ctx = await resolveProjectContext(db, projectId, caller.email)
  if (!ctx) throw createProblemError({ status: 404, title: 'Project not found' })
  if (!canLogToProject(ctx)) {
    throw createProblemError({ status: 403, title: 'No permission to log time on this project' })
  }

  let durationMinutes: number | null = null
  let startedAt: number | null = null
  let endedAt: number | null = null

  if (typeof body?.started_at === 'number' && typeof body?.ended_at === 'number') {
    if (body.ended_at <= body.started_at) {
      throw createProblemError({ status: 400, title: 'ended_at must be after started_at' })
    }
    startedAt = body.started_at
    endedAt = body.ended_at
    durationMinutes = Math.round((endedAt - startedAt) / 60)
  }
  else {
    durationMinutes = parseDurationMinutes(body?.duration)
  }
  if (durationMinutes == null || durationMinutes <= 0) {
    throw createProblemError({ status: 400, title: 'duration required (minutes, "1h30m", or started_at/ended_at)' })
  }
  if (durationMinutes > 24 * 60) {
    throw createProblemError({ status: 400, title: 'duration must be ≤ 24h' })
  }

  let entryDate = body?.date?.trim()
  if (entryDate) {
    if (!isValidDate(entryDate)) throw createProblemError({ status: 400, title: 'date must be YYYY-MM-DD' })
  }
  else if (startedAt) {
    entryDate = new Date(startedAt * 1000).toISOString().slice(0, 10)
  }
  else {
    entryDate = todayUtc()
  }

  // Every entry must have a concrete von/bis. If the caller didn't supply
  // started_at/ended_at, derive a deterministic block from the duration.
  if (startedAt == null || endedAt == null) {
    const block = deriveBlock(entryDate, durationMinutes)
    startedAt = block.startedAt
    endedAt = block.endedAt
  }

  const type = body?.type ?? 'code'
  if (!VALID_TYPE.has(type)) throw createProblemError({ status: 400, title: 'invalid type' })

  const description = body?.description?.trim() ?? ''
  if (description.length > 1000) throw createProblemError({ status: 400, title: 'description must be ≤ 1000 chars' })

  const isBreak = body?.is_break === true
  // A break is never billable, regardless of what the client sent.
  const billable = isBreak ? false : (typeof body?.billable === 'boolean' ? body.billable : true)
  const createdVia = body?.created_via === 'cli' ? 'cli' : 'web'

  const now = Math.floor(Date.now() / 1000)
  const id = ulid()
  await db.insert(timeEntries).values({
    id,
    companyId: ctx.companyId,
    projectId,
    userEmail: caller.email,
    act: caller.act,
    entryDate,
    durationMinutes,
    startedAt,
    endedAt,
    description,
    type: type as 'code' | 'research' | 'planning' | 'review' | 'admin' | 'meeting',
    billable,
    isBreak,
    createdVia,
    createdAt: now,
    updatedAt: now,
    updatedBy: caller.email,
  })

  const row = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).get()
  setResponseStatus(event, 201)
  return serializeEntry(row!)
})
