import type { H3Event } from 'h3'
import { getRequestURL, setHeader } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createProblemError } from './problem'
import { privateReportHeaders } from './report-auth'
import { documentCsp } from './document-sanitizer'

export function requireDocumentPublishing() {
  const enabled = useRuntimeConfig().documentPublishingEnabled
  if (String(enabled) !== 'true') throw createProblemError({ status: 503, title: 'Document publishing is disabled' })
}

export function documentUrls(event: H3Event, slug: string) {
  const config = useRuntimeConfig()
  const base = String(config.briefingUrl || config.publicUrl || getRequestURL(event).origin).replace(/\/$/, '')
  return { url: `${base}/r/${slug}`, edition_url: `${base}/r/${slug}` }
}

export function documentHeaders(event: H3Event) {
  privateReportHeaders(event)
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'content-security-policy', documentCsp)
  setHeader(event, 'x-content-type-options', 'nosniff')
  setHeader(event, 'permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
}
