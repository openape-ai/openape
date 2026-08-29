import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { isOutcome, stageKey } from '#shared/stages'
import { useDb } from '../../database/drizzle'
import { pipelineStages } from '../../database/schema'
import { createProblemError } from '../../utils/problem'
import { listStages, parseStageName, writePositions } from '../../utils/stages'
import { requireRole } from '../../utils/workspace-access'

const MAX_STAGES = 20

interface Body {
  workspace_id?: string
  name?: string
  outcome?: string
  /** Key of the stage to insert after; when absent the new one goes to the end. */
  after?: string | null
}

/** POST /api/stages — neue Stufe, wahlweise mitten in der Pipeline. */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<Body>(event)
  const workspaceId = body?.workspace_id
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })

  const db = useDb()
  await requireRole(db, workspaceId, caller.email, 'manager')

  const name = parseStageName(body?.name)
  const outcome = body?.outcome === undefined ? 'open' : body.outcome
  if (!isOutcome(outcome)) throw createProblemError({ status: 400, title: 'outcome must be open|won|lost' })

  const stages = await listStages(db, workspaceId)
  if (stages.length >= MAX_STAGES) {
    throw createProblemError({ status: 409, title: `a pipeline holds at most ${MAX_STAGES} stages` })
  }

  const key = stageKey(name, stages.map(s => s.key))
  const at = body?.after ? stages.findIndex(s => s.key === body.after) + 1 : stages.length
  const order = stages.map(s => s.key)
  order.splice(at, 0, key)

  await db.insert(pipelineStages).values({ workspaceId, key, name, outcome, position: order.indexOf(key) })
  await writePositions(db, workspaceId, order)

  setResponseStatus(event, 201)
  return { key, name, outcome, position: order.indexOf(key) }
})
