import type { H3Event } from 'h3'
import { createLocalJWKSet, jwtVerify } from 'jose'
import { getHeader, getMethod, getRequestURL, setHeader } from 'h3'
import { createProblemError } from './problem'

export function privateReportHeaders(event: H3Event) {
  setHeader(event, 'cache-control', 'private, no-store')
  setHeader(event, 'vary', 'Cookie, Authorization')
  setHeader(event, 'referrer-policy', 'no-referrer')
  setHeader(event, 'x-robots-tag', 'noindex, nofollow')
}

export async function reportOwner(event: H3Event, scope = 'reports:read') {
  privateReportHeaders(event)
  const principal = await requireScopedPrincipal(event, [scope])
  if (!['GET', 'HEAD'].includes(getMethod(event)) && principal.authentication === 'session' && getHeader(event, 'origin') !== getRequestURL(event).origin) {
    throw createProblemError({ status: 403, title: 'Matching Origin required' })
  }
  return principal
}

export async function verifyReportPublisher(token: string, expectedSubject: string): Promise<string> {
  const resolved = await resolveIssuerForToken(token)
  if (!resolved || resolved.sub !== expectedSubject) throw createProblemError({ status: 401, title: 'Publisher authentication required' })
  await assertSafeIdpUrl(resolved.issuer)
  const response = await fetch(resolved.jwksUri, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!response.ok || Number(response.headers.get('content-length')) > 65536) throw createProblemError({ status: 502, title: 'Publisher identity unavailable' })
  const reader = response.body?.getReader()
  if (!reader) throw createProblemError({ status: 502, title: 'Publisher identity unavailable' })
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 65536) throw createProblemError({ status: 502, title: 'Publisher identity response too large' })
      chunks.push(value)
    }
  }
  finally { await reader.cancel() }
  try {
    const keys = createLocalJWKSet(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    const { payload } = await jwtVerify(token, keys, { algorithms: ['EdDSA', 'ES256', 'RS256'], issuer: resolved.issuer, audience: 'apes-cli', subject: expectedSubject, requiredClaims: ['exp', 'iat', 'sub'] })
    if (payload.act !== 'agent' || payload.delegate !== undefined || payload.delegation_grant !== undefined || payload.grant_id !== undefined || payload.scope !== undefined || payload.scopes !== undefined) {
      throw new Error('Direct unscoped agent identity required')
    }
    return expectedSubject
  }
  catch {
    throw createProblemError({ status: 401, title: 'Invalid publisher identity' })
  }
}

export async function reportPublisher(event: H3Event, series: { owner: string, publisher: string | null }) {
  privateReportHeaders(event)
  const authorization = getHeader(event, 'authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (token && series.publisher && unsafeDecodeSub(token) === series.publisher) return await verifyReportPublisher(token, series.publisher)
  const principal = await reportOwner(event, 'reports:publish')
  if (principal.subject !== series.owner) throw createProblemError({ status: 404, title: 'Report series not found' })
  return principal.actor
}
