import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export function briefingUrls(event: H3Event, slug: string, version: number) {
  const base = (useRuntimeConfig().briefingUrl as string).replace(/\/$/, '') || getRequestURL(event).origin
  const url = `${base}/r/${slug}`
  return { url, edition_url: `${url}?v=${version}` }
}
