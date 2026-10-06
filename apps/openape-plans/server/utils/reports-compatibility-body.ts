import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'

export async function readCompatibilityBody(event: H3Event) {
  const limit = 40 * 1024 * 1024
  if (getHeader(event, 'content-type')?.split(';')[0]?.trim() !== 'application/json') throw createError({ statusCode: 415, statusMessage: 'JSON required' })
  const encoding = getHeader(event, 'content-encoding')
  if (encoding && encoding !== 'identity') throw createError({ statusCode: 415, statusMessage: 'Compressed requests are unsupported' })
  if (Number(getHeader(event, 'content-length')) > limit) throw createError({ statusCode: 413, statusMessage: 'Plan request exceeds byte limit' })
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of event.node.req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) { event.node.req.resume(); throw createError({ statusCode: 413, statusMessage: 'Plan request exceeds byte limit' }) }
    chunks.push(bytes)
  }
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)) }
  catch { throw createError({ statusCode: 400, statusMessage: 'Invalid UTF-8 request' }) }
}
