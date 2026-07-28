import { requireCockpitAgent } from '../../../../utils/cockpit/auth'
import { saveFile } from '../../../../utils/cockpit/file-store'

// Agent upload — the Operator's proof channel (screenshots, generated PDFs).
// Same validation as the owner path; the agent identity IS the owner scope.
export default defineEventHandler(async (event) => {
  const agent = await requireCockpitAgent(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'multipart field "file" required' })
  const orgId = parts?.find(p => p.name === 'company')?.data?.toString('utf8') ?? ''
  const result = await saveFile(agent, orgId, file.filename ?? 'datei', file.type ?? '', Buffer.from(file.data))
  if ('error' in result) throw createError({ statusCode: result.status, statusMessage: result.error })
  return result
})
