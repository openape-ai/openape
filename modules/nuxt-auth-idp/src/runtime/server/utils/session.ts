import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useGrantStorage } from './grant-storage'
import { qrSessionKey } from './qr-login'

export async function getAppSession(event: H3Event) {
  const config = useRuntimeConfig()
  const idpConfig = config.openapeIdp as Record<string, unknown>
  const slug = event.context?.openapeTenantSlug as string | undefined
  const sessionName = slug ? `openape-idp-${slug}` : 'openape-idp'
  // When the IdP is embedded in an iframe (allowedFrameAncestors is set),
  // cookies must use sameSite: 'none' or the browser will reject them in
  // the cross-origin context. 'none' requires secure: true (already set).
  const embeddable = !!(process.env.NUXT_OPENAPE_IDP_ALLOWED_FRAME_ANCESTORS || idpConfig.allowedFrameAncestors)
  // When a CORS allowlist is configured (M4β cross-SP flow per
  // sp-data-access.md), Receiver SPs need to fetch IdP endpoints
  // from the Owner's browser with credentials:'include'. The browser
  // only sends the IdP cookie on those cross-origin XHRs if
  // sameSite='none'. The CORS plugin pairs with this — both
  // strict-equality on the same env so they can't drift.
  const corsAllowlist = !!(process.env.NUXT_OPENAPE_IDP_CORS_ALLOWED_ORIGINS)
  const crossOrigin = embeddable || corsAllowlist
  const session = await useSession(event, {
    name: sessionName,
    password: idpConfig.sessionSecret as string,
    maxAge: (idpConfig.sessionMaxAge as number) || 60 * 60 * 24 * 7,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: crossOrigin ? 'none' : 'lax',
    },
  })

  // Sessions that arrived via QR sign-in live on machines the user does not
  // control (public computers). They carry their own, much shorter expiry,
  // and stay valid only while their server-side record exists — deleting
  // that record from any other device revokes the kiosk remotely.
  const data = session.data as { userId?: string, qrChannelId?: string, qrExpiresAt?: number }
  if (data.userId && typeof data.qrChannelId === 'string') {
    const expired = typeof data.qrExpiresAt !== 'number' || data.qrExpiresAt < Date.now()
    const revoked = expired || !(await useGrantStorage().getItem(qrSessionKey(data.qrChannelId)))
    if (revoked) {
      await session.clear()
    }
  }

  return session
}
