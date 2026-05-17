import { SignJWT } from 'jose'
import { resolveCaller } from '../utils/auth'

// Mint a short-lived HMAC-signed token the Web UI uses to authenticate its
// WebSocket connection. The browser cannot send custom Authorization headers
// on a WS upgrade; passing a cookie-derived token via `?token=` is the
// canonical workaround.
//
// The token is signed with the SP session secret (HS256) and verified by
// the WS handler. Lifetime is intentionally short — the Web UI re-fetches
// per connect, and re-fetches on reconnect, so a 5-minute window is plenty.

const TOKEN_TTL_SECONDS = 5 * 60

export default defineEventHandler(async (event) => {
  // Same auth resolver REST routes use — succeeds for cookie sessions and
  // for Bearer-authenticated agents alike. Bearer callers don't need this
  // endpoint (they connect WS with their own JWKS-verified token), but it
  // doesn't hurt to issue one.
  const caller = await resolveCaller(event)

  const config = useRuntimeConfig()
  const secret = (config.openapeSp?.sessionSecret as string) || ''
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: 'WS token secret not configured' })
  }

  const key = new TextEncoder().encode(secret)
  const now = Math.floor(Date.now() / 1000)

  const token = await new SignJWT({ email: caller.email, act: caller.act })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .setIssuer('chat.openape.ai')
    .setAudience('chat.openape.ai/ws')
    .sign(key)

  return { token, expires_in: TOKEN_TTL_SECONDS }
})
