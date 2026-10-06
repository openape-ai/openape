import { useRuntimeConfig } from 'nitropack/runtime'
import { createError, getHeader, getRequestURL, setResponseStatus, setHeader } from 'h3'
import type { H3Event } from 'h3'
import { sha256 } from '@openape/pods-protocol/crypto'
import { parseOwner, ProtocolError, sameOwner } from '@openape/pods-protocol'
import { RelayStore } from './store'
import type { Registration } from './store'
import { RelayAuth } from './auth'

let instance: RelayStore | undefined
const requests = new Map<string, { start: number, count: number }>()
function limitRequests(event: H3Event): void {
  const now = Date.now()
  for (const [key, bucket] of requests) {
    if (now - bucket.start >= 60000) requests.delete(key)
  }
  const login = getRequestURL(event).pathname.includes('/session/') || getRequestURL(event).pathname.startsWith('/mobile-auth/')
  const key = sha256(`${event.node.req.socket.remoteAddress}:${login ? 'login' : 'api'}`)
  const bucket = requests.get(key) ?? { start: now, count: 0 }
  if ((!requests.has(key) && requests.size >= 10000) || bucket.count >= (login ? 60 : 600)) throw new ProtocolError('rate_limited', 429)
  bucket.count++; requests.set(key, bucket)
}
export function relay() {
  const config = useRuntimeConfig()
  if (!config.relayEnabled) throw createError({ statusCode: 503, statusMessage: 'Remote access is disabled' })
  instance ??= new RelayStore(String(config.relayDatabase))
  return instance
}
export function auth() {
  const config = useRuntimeConfig()
  const fixture = config.relayFixture && new URL(String(config.relayOrigin)).hostname === '127.0.0.1'
  const allowlist = config.relayOwnerAllowlist as unknown
  if (!Array.isArray(allowlist)) throw new Error('Relay owner allowlist must be a JSON array')
  const owners = allowlist.map(parseOwner)
  return new RelayAuth(relay(), String(config.relayOrigin), fixture ? String(config.relayIdpUrl) : '', owner => config.relayEnrollment === 'public' || (config.relayEnrollment === 'pilot' && owners.some(allowed => sameOwner(owner, allowed))))
}
export function actor(event: H3Event, kind: Registration['kind'] = 'mobile') {
  setHeader(event, 'cache-control', 'no-store')
  const authorization = getHeader(event, 'authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) throw new ProtocolError('authentication_required', 401)
  const url = getRequestURL(event)
  const proof = { id: getHeader(event, 'x-pods-request-id') ?? '', at: getHeader(event, 'x-pods-request-at') ?? '', digest: getHeader(event, 'x-pods-body-digest') ?? '', signature: getHeader(event, 'x-pods-proof') ?? '' }
  if (['GET', 'DELETE'].includes(event.method) && proof.digest !== sha256('')) throw new ProtocolError('invalid_request_proof', 401)
  const caller = relay().authenticateRequest(authorization.slice(7), kind, event.method, url.pathname + url.search, proof)
  event.context.podsBodyDigest = proof.digest
  return caller
}
export async function body(event: H3Event): Promise<unknown> {
  setHeader(event, 'cache-control', 'no-store')
  const origin = getHeader(event, 'origin')
  if (origin && origin !== String(useRuntimeConfig().relayOrigin)) throw new ProtocolError('invalid_origin', 403)
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) throw new ProtocolError('json_required', 415)
  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > 65536) throw new ProtocolError('frame_too_large', 413)
  const chunks: Buffer[] = []; let length = 0
  for await (const chunk of event.node.req) {
    const bytes = Buffer.from(chunk); length += bytes.length
    if (length > 65536) throw new ProtocolError('frame_too_large', 413)
    chunks.push(bytes)
  }
  const data = Buffer.concat(chunks).toString('utf8')
  if (!data) throw new ProtocolError('invalid_json')
  if (event.context.podsBodyDigest && sha256(data) !== event.context.podsBodyDigest) throw new ProtocolError('invalid_request_body', 401)
  try { return JSON.parse(data) }
  catch { throw new ProtocolError('invalid_json') }
}
export async function boundary<T>(event: H3Event, run: () => T | Promise<T>): Promise<T | { type: string, title: string, status: number, instance: string, code: string }> {
  setHeader(event, 'cache-control', 'no-store')
  try { limitRequests(event); return await run() }
  catch (error) {
    if (error instanceof ProtocolError) {
      setResponseStatus(event, error.status)
      if (error.status === 429 || error.status === 503) setHeader(event, 'retry-after', error.status === 429 ? 60 : 15)
      setHeader(event, 'content-type', 'application/problem+json')
      return { type: `https://pods.openape.ai/problems/${error.code}`, title: error.code, status: error.status, instance: getRequestURL(event).pathname, code: error.code }
    }
    throw error
  }
}
