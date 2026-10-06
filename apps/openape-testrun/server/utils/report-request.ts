import type { H3Event } from 'h3'
import { getHeader, getRequestIP, setHeader } from 'h3'
import { createProblemError } from './problem'

const requests = new Map<string, { start: number, count: number }>()
export function limitReportRequests(event: H3Event) {
  const now = Date.now()
  for (const [key, window] of requests) {
    if (now - window.start > 60000) requests.delete(key)
  }
  const key = getRequestIP(event) || 'unknown'
  const window = requests.get(key) || { start: now, count: 0 }
  window.count++
  requests.set(key, window)
  if (window.count > 60) {
    setHeader(event, 'retry-after', 60)
    throw createProblemError({ status: 429, title: 'Too many report requests' })
  }
}

export async function readReportBody(event: H3Event, limit = 60 * 1024) {
  if (getHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/json') throw createProblemError({ status: 415, title: 'JSON required' })
  if (getHeader(event, 'content-encoding') && getHeader(event, 'content-encoding') !== 'identity') throw createProblemError({ status: 415, title: 'Compressed reports are unsupported' })
  if (Number(getHeader(event, 'content-length')) > limit) throw createProblemError({ status: 413, title: 'Report exceeds byte limit' })
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) { event.node.req.resume(); throw createProblemError({ status: 413, title: 'Report exceeds byte limit' }) }
    chunks.push(bytes)
  }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))
    return { raw, data: JSON.parse(raw) as unknown }
  }
  catch { throw createProblemError({ status: 400, title: 'Invalid JSON' }) }
}
