import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export async function getAppSession(event: H3Event) {
  const config = useRuntimeConfig()
  const idpConfig = config.openapeIdp as Record<string, unknown>
  const slug = event.context?.openapeTenantSlug as string | undefined
  const sessionName = slug ? `openape-idp-${slug}` : 'openape-idp'
  return await useSession(event, {
    name: sessionName,
    password: idpConfig.sessionSecret as string,
    maxAge: (idpConfig.sessionMaxAge as number) || 60 * 60 * 24 * 7,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    },
  })
}
