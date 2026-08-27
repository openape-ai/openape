import { defineEventHandler, getQuery } from 'h3'
import { mapDriveChildren } from '#shared/graph-live'
import { listDriveChildren } from '../../utils/graph'
import { requireGraphAccess } from '../../utils/graph-account'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const itemId = String(getQuery(event).item_id ?? '') || null
  const graph = await requireGraphAccess(caller.email)
  const folder = await listDriveChildren(graph.accessToken, itemId)
  return {
    id: folder.id,
    name: folder.name,
    web_url: folder.webUrl || null,
    parent_id: folder.parentReference?.id ?? null,
    children: mapDriveChildren(folder.children ?? []),
  }
})
