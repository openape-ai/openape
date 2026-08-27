import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { dealFiles, deals } from '../../../database/schema'
import { createOrgLink, encodedDrivePath, ensureDealFolder, graphPut } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string, content_base64?: string, mime?: string, contract_id?: string }>(event)
  const name = body?.name?.trim()
  const content = body?.content_base64
  if (!name || !content) throw createProblemError({ status: 400, title: 'name and content_base64 required' })
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const graph = await requireGraphAccess(caller.email)
  await ensureDealFolder(graph.accessToken, deal.workspaceId, deal.id)
  const path = `/me/drive/root:/${encodedDrivePath(['OpenApe CRM', deal.workspaceId, deal.id, name])}:/content`
  const uploaded = await graphPut(
    graph.accessToken,
    path,
    Buffer.from(content, 'base64'),
    body.mime || 'application/octet-stream',
  )
  const share = await createOrgLink(graph.accessToken, uploaded.id) || uploaded.webUrl
  const fileId = ulid()
  await db.insert(dealFiles).values({
    id: fileId,
    dealId: deal.id,
    contractId: body.contract_id || null,
    name: uploaded.name || name,
    driveItemId: uploaded.id,
    webUrl: share,
    mime: body.mime || null,
    size: uploaded.size ?? null,
    createdAt: Date.now(),
  })
  setResponseStatus(event, 201)
  return { id: fileId, name: uploaded.name || name, web_url: share }
})
