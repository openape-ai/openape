import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export async function getAppSession(event: H3Event) {
  const config = useRuntimeConfig()
  const idpConfig = config.openapeIdp as Record<string, unknown>
  const slug = event.context?.openapeTenantSlug as string | undefined
  const sessionName = slug ? `openape-idp-${slug}` : 'openape-idp'
  // When the IdP is embedded in an iframe (allowedFrameAncestors is set),
  // cookies must use sameSite: 'none' or the browser will reject them in
  // the cross-origin context. 'none' requires secure: true (already set).
  const embeddable = !!(process.env.NUXT_OPENAPE_IDP_ALLOWED_FRAME_ANCESTORS || idpConfig.allowedFrameAncestors)
  return await useSession(event, {
    name: sessionName,
    password: idpConfig.sessionSecret as string,
    maxAge: (idpConfig.sessionMaxAge as number) || 60 * 60 * 24 * 7,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: embeddable ? 'none' : 'lax',
    },
  })
}
