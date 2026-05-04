import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getHeader, readBody, useSession } from 'h3'

const RE_BEARER_PREFIX = /^Bearer\s+/i

// Defence-in-depth gate (#293).
//
// The endpoint is for E2E tests only. Active gating is `OPENAPE_E2E=1`
// at startup; `import.meta.dev` would also block it in built bundles
// when the env-var leaks. Even at request time we additionally require
// `process.env.NODE_ENV !== 'production'` so a Vercel preview that
// happened to inherit OPENAPE_E2E=1 alongside production NODE_ENV
// still refuses to mint sessions.
function gateOpen(): boolean {
  if (process.env.OPENAPE_E2E !== '1') return false
  if (process.env.NODE_ENV === 'production') return false
  return true
}

function constantTimeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export default defineEventHandler(async (event) => {
  if (!gateOpen()) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const config = useRuntimeConfig()
  const auth = getHeader(event, 'authorization')
  const token = auth?.replace(RE_BEARER_PREFIX, '') ?? ''
  const expected = String(config.openapeIdp.managementToken ?? '')
  // Both length-equality short-circuit and timing-safe compare so a
  // probing client can't infer the management token via response-time
  // measurements. Rejecting empty expected too — if the token isn't
  // configured we never want to silently accept anything.
  if (!expected || !constantTimeEqualString(token, expected)) {
    throw createError({ statusCode: 401, statusMessage: 'Management token required' })
  }

  const body = await readBody<{ email?: string }>(event)
  if (!body.email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email' })
  }

  const session = await useSession(event, {
    name: 'openape-idp',
    password: config.openapeIdp.sessionSecret,
  })

  await session.update({
    userId: body.email,
  })

  return { ok: true, email: body.email }
})
