import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { ProtocolError } from '@openape/pods-protocol'
import { afterEach, expect, it, vi } from 'vitest'
import { actor, boundary } from '../server/utils/service'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: vi.fn() }))
afterEach(() => { vi.restoreAllMocks() })

function event(path: string) {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = path
  request.headers.host = 'relay.example'
  return createEvent(request, new ServerResponse(request))
}

it.each(['/api/runtime/v1/workspace', '/api/mobile/v1/session/begin', '/mobile-auth/start'])('does not throttle repeated requests to %s', async (path) => {
  vi.spyOn(Date, 'now').mockReturnValue(1_792_483_200_000)
  for (let index = 0; index < 650; index++) {
    const request = event(path)
    await expect(boundary(request, () => ({ ok: true }))).resolves.toEqual({ ok: true })
    expect(request.node.res.statusCode).toBe(200)
    expect(request.node.res.getHeader('retry-after')).toBeUndefined()
  }
})

it('still refuses an unauthenticated runtime request', async () => {
  const request = event('/api/runtime/v1/workspace')
  await expect(boundary(request, () => actor(request))).resolves.toMatchObject({ code: 'authentication_required', status: 401 })
  expect(request.node.res.statusCode).toBe(401)
  expect(request.node.res.getHeader('cache-control')).toBe('no-store')
})

it('preserves the unavailable response and retry hint', async () => {
  const request = event('/api/runtime/v1/workspace')
  await expect(boundary(request, () => { throw new ProtocolError('unavailable', 503) })).resolves.toMatchObject({ code: 'unavailable', status: 503 })
  expect(request.node.res.getHeader('retry-after')).toBe(15)
})
