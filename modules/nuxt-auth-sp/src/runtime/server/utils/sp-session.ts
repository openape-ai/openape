import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function getSpSession(event: H3Event) {
  const config = useRuntimeConfig()
  const maxAge = Number(config.openapeSp.sessionMaxAge) || DEFAULT_SESSION_MAX_AGE
  return await useSession(event, {
    name: 'openape-sp',
    password: config.openapeSp.sessionSecret,
    // Explicit max-age so iOS Safari doesn't evict this as a session cookie.
    maxAge,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge,
    },
  })
}
