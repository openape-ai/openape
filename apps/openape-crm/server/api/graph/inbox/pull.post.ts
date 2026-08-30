import { defineEventHandler, getQuery } from 'h3'
import { ingestInboxMessages } from '../../../utils/inbox'
import { listInbox } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'
import { useDb } from '../../../database/drizzle'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const workspaceId = String(getQuery(event).workspace_id ?? '')
  if (!workspaceId) throw createProblemError({ status: 400, title: 'workspace_id required' })
  const db = useDb()
  await requireRole(db, workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  const messages = await listInbox(graph.accessToken)
  return await ingestInboxMessages(db, {
    workspaceId,
    selfMail: graph.mail || caller.email,
    messages,
  })
})
