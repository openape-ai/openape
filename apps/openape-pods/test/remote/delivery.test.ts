// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { parseEnvelope } from '@openape/pods-protocol'
import type { Route } from '@openape/pods-protocol'
import { generateKey, publicKey, seal } from '@openape/pods-protocol/crypto'
import { responseFrames } from '../../src/worker/remote/delivery'

it('delivers an exact large review in bounded independently authenticated frames', () => {
  const now = Date.now()
  const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: randomUUID(), generation: randomUUID(), deviceId: randomUUID(), keyEpoch: 1, owner: { issuer: 'https://id.example', subject: 'owner@example.test' }, direction: 'response', kind: 'receipt', kindVersion: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), sequence: '0' }
  const result = { receipt: { operationId: route.id, state: 'completed' }, data: { review: 'Exact review ✓\n'.repeat(20000) } }
  const frames = responseFrames(route, result)
  const key = generateKey(); const recipient = publicKey(generateKey())
  for (const frame of frames) expect(parseEnvelope(seal(frame.route, frame.body, recipient, key))).toBeDefined()
  const content = frames.slice(0, -1).map(frame => Buffer.from((frame.body as { chunk: string }).chunk, 'base64url'))
  const bytes = Buffer.concat(content)
  expect(JSON.parse(bytes.toString('utf8'))).toEqual(result)
  expect(frames.at(-1)).toMatchObject({ route: { id: route.id }, body: { receipt: result.receipt, transfer: { digest: createHash('sha256').update(bytes).digest('hex') } } })
})
