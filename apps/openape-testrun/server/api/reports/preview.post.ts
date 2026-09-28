import { defineEventHandler } from 'h3'
import { reportOwner } from '../../utils/report-auth'
import { limitReportRequests, readReportBody } from '../../utils/report-request'
import { documentBodyLimit, validateDocument } from '../../utils/document-shape'
import { sanitizeDocument } from '../../utils/document-sanitizer'
import { documentHeaders, requireDocumentPublishing } from '../../utils/document-response'

export default defineEventHandler(async (event) => {
  documentHeaders(event)
  limitReportRequests(event)
  await reportOwner(event, 'reports:publish')
  requireDocumentPublishing()
  const { data } = await readReportBody(event, documentBodyLimit)
  return sanitizeDocument(validateDocument(data)).artifact
})
