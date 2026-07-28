import { requireCockpitAgent } from '../../../../utils/cockpit/auth'
import { loadFile } from '../../../../utils/cockpit/file-store'

// Worker download: the task carries file refs; the worker fetches the bytes
// into its scratch dir (images go to `codex exec -i`). Owner-bound — a foreign
// agent gets 404, never bytes.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  const row = await loadFile(agent, id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'unknown file' })
  setHeader(event, 'content-type', row.mime)
  setHeader(event, 'cache-control', 'no-store')
  return row.bytes
})
