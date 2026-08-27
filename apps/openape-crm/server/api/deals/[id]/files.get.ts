import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { dealFiles, deals } from '../../../database/schema'
import { ensureDealFolder, graphJson } from '../../../utils/graph'
import { requireGraphAccess } from '../../../utils/graph-account'
import { createProblemError } from '../../../utils/problem'
import { requireRole } from '../../../utils/workspace-access'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const id = getRouterParam(event, 'id')!
  const db = useDb()
  const deal = await db.select().from(deals).where(eq(deals.id, id)).get()
  if (!deal) throw createProblemError({ status: 404, title: 'deal not found' })
  await requireRole(db, deal.workspaceId, caller.email)
  const stored = await db.select({
    id: dealFiles.id,
    name: dealFiles.name,
    web_url: dealFiles.webUrl,
    mime: dealFiles.mime,
    size: dealFiles.size,
  }).from(dealFiles).where(eq(dealFiles.dealId, id)).all()
  try {
    const graph = await requireGraphAccess(caller.email)
    const folder = await ensureDealFolder(graph.accessToken, deal.workspaceId, deal.id)
    const live = await graphJson<{ value: { id: string, name: string, webUrl: string, size?: number, file?: { mimeType?: string } }[] }>(
      graph.accessToken,
      `/me/drive/items/${folder.id}/children`,
    )
    return {
      folder_web_url: folder.webUrl,
      files: (live.value ?? []).map(item => ({
        id: item.id,
        name: item.name,
        web_url: item.webUrl,
        mime: item.file?.mimeType ?? null,
        size: item.size ?? null,
      })),
    }
  }
  catch {
    return { folder_web_url: null, files: stored }
  }
})
