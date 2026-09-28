import { eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { documentPublications } from '../../../../database/schema'
import { loadRunBySlug, requestedVersion } from '../../../../utils/run-access'
import { documentHeaders } from '../../../../utils/document-response'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  documentHeaders(event)
  const run = await loadRunBySlug(event, getRouterParam(event, 'slug')!)
  requestedVersion(event, run)
  if (run.reportType !== 'document') throw createProblemError({ status: 404, title: 'Document not found' })
  const document = await useDb().select({ artifact: documentPublications.artifact }).from(documentPublications).where(eq(documentPublications.id, run.id)).get()
  if (!document) throw createProblemError({ status: 404, title: 'Document not found' })
  return document.artifact
})
