import { cockpitOwner } from '../../../utils/cockpit/auth'
import { saveFile } from '../../../utils/cockpit/file-store'

// Owner upload (multipart): field `file` + optional `company`. Returns the ref
// the client passes along with its next chat message.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'multipart field "file" required' })
  const orgId = parts?.find(p => p.name === 'company')?.data?.toString('utf8') ?? ''
  const result = await saveFile(owner, orgId, file.filename ?? 'datei', file.type ?? '', Buffer.from(file.data))
  if ('error' in result) throw createError({ statusCode: result.status, statusMessage: result.error })
  return result
})
