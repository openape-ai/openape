import { defineEventHandler, getHeader, getRequestURL, getRouterParam, setHeaders } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { contentPolicy, ReportError } from '../../../shared/html-publication'
import { useDatabaseClient } from '../../database/drizzle'
import { htmlCapability } from '../../utils/html-capability'
import { htmlProblem } from '../../utils/html-api'
import { readHtml } from '../../utils/html-store'

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig()
    if (!config.htmlContentOrigin || getRequestURL(event).origin !== new URL(String(config.htmlContentOrigin)).origin || getHeader(event, 'sec-fetch-dest') !== 'iframe') throw new ReportError('FORBIDDEN', 'Open this document through its Reports viewer', 403)
    const capability = htmlCapability(getRouterParam(event, 'key') ?? '')
    const { document, version } = await readHtml(useDatabaseClient(), capability.documentId, capability.identity, capability.version)
    if (document.access_revision !== capability.accessRevision || document.retention_revision !== capability.retentionRevision) throw new ReportError('FORBIDDEN', 'Report policy changed; reopen the viewer', 403)
    setHeaders(event, {
      'content-type': 'text/html; charset=utf-8', 'content-security-policy': contentPolicy(JSON.parse(String(version.external_images)).length > 0, capability.viewerOrigin),
      'referrer-policy': 'no-referrer', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'x-robots-tag': 'noindex, nofollow',
    })
    return String(version.html)
  }
  catch (error) { htmlProblem(error) }
})
