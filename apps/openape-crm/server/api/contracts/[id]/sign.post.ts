import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { contracts } from '../../../database/schema'
import { createProblemError } from '../../../utils/problem'
import { applySignaturStub } from '../../../utils/sign-contract'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()
  const contract = await db.select().from(contracts).where(eq(contracts.id, id)).get()
  if (!contract) throw createProblemError({ status: 404, title: 'contract not found' })
  await requireRole(db, contract.workspaceId, caller.email)
  return await applySignaturStub(db, id, caller.email)
})
