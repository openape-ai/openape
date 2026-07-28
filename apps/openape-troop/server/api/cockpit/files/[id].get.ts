import { cockpitOwner } from '../../../utils/cockpit/auth'
import { loadFile } from '../../../utils/cockpit/file-store'

// Owner download — bubbles render <img src> straight at this. Ids are UUIDs and
// content is immutable, so aggressive private caching is safe.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const row = await loadFile(owner, id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'unknown file' })
  setHeader(event, 'content-type', row.mime)
  setHeader(event, 'content-disposition', `inline; filename="${row.name}"`)
  setHeader(event, 'cache-control', 'private, max-age=31536000, immutable')
  return row.bytes
})
