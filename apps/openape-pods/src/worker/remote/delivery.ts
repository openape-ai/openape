import { createHash, randomUUID } from 'node:crypto'
import type { Route } from '@openape/pods-protocol'

export function responseFrames(route: Route, result: { receipt: unknown, data: unknown }): { route: Route, body: unknown }[] {
  const bytes = Buffer.from(JSON.stringify(result))
  if (bytes.length <= 24 * 1024) return [{ route, body: result }]
  if (bytes.length > 2 * 1024 * 1024) return [{ route, body: { receipt: result.receipt, unavailable: 'content_requires_desktop' } }]
  const digest = createHash('sha256').update(bytes).digest('hex')
  const count = Math.ceil(bytes.length / (24 * 1024))
  const transfer = { operationId: route.id, digest, count }
  const frames = Array.from({ length: count }, (_, index) => ({ route: { ...route, id: randomUUID(), direction: 'event' as const, kind: 'snapshot' as const }, body: { transfer, index, chunk: bytes.subarray(index * 24 * 1024, (index + 1) * 24 * 1024).toString('base64url') } }))
  return [...frames, { route, body: { receipt: result.receipt, transfer } }]
}
