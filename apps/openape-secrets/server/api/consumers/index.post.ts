import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../database/drizzle'
import { consumers } from '../../database/schema'
import { callerEmail } from '../../utils/access'
import { createProblemError } from '../../utils/problem'

interface Body {
  name?: unknown
  publicKeyJwk?: unknown
  allowedRequesters?: unknown
}

/**
 * POST /api/consumers — register a machine that may receive secrets.
 *
 * The caller becomes the owner: the only person a request for this consumer
 * will ever ask. The key is stored as given and never used here — this service
 * seals nothing and opens nothing, it only holds what the browser produced.
 */
export default defineEventHandler(async (event) => {
  const owner = await callerEmail(event)
  const body = await readBody<Body>(event)

  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!name) throw createProblemError({ status: 400, title: 'name required' })

  const jwk = body?.publicKeyJwk
  if (!isP256PublicJwk(jwk)) {
    throw createProblemError({
      status: 400,
      title: 'publicKeyJwk must be a public P-256 JWK',
      // Naming the reason matters: the private half arriving here would be the
      // worst possible outcome, and a vague 400 invites a retry with more data.
      detail: 'Expected { kty: "EC", crv: "P-256", x, y } and no private component `d`.',
    })
  }

  const allowedRequesters = Array.isArray(body?.allowedRequesters)
    ? (body.allowedRequesters as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
    : []

  const row = {
    id: ulid(),
    ownerEmail: owner,
    name,
    publicKeyJwk: JSON.stringify(jwk),
    allowedRequesters: JSON.stringify(allowedRequesters),
    createdAt: Math.floor(Date.now() / 1000),
  }
  await useDb().insert(consumers).values(row)

  setResponseStatus(event, 201)
  return { id: row.id, name, allowed_requesters: allowedRequesters, created_at: row.createdAt }
})

/**
 * A public P-256 JWK and nothing else. `d` is the private half: if it shows up
 * we refuse rather than store it, because a service that holds private keys is
 * exactly the single point of compromise this design exists to avoid.
 */
export function isP256PublicJwk(v: unknown): v is { kty: string, crv: string, x: string, y: string } {
  if (!v || typeof v !== 'object') return false
  const k = v as Record<string, unknown>
  if (k.kty !== 'EC' || k.crv !== 'P-256') return false
  if (typeof k.x !== 'string' || typeof k.y !== 'string') return false
  return !('d' in k)
}
