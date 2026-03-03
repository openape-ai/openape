import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from '#imports'

export async function getAppSession(event: H3Event) {
  const config = useRuntimeConfig()
  return await useSession(event, {
    name: 'openape-free-idp',
    password: config.sessionSecret,
    cookie: {
      httpOnly: true,
      secure: !import.meta.dev,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    },
  })
}
