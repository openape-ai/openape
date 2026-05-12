import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { AuthFlowState } from '@openape/core'

const FLOW_COOKIE = 'openape-flow'

export function getSpConfig() {
  const config = useRuntimeConfig()
  // The module's auto-generated runtime-config type doesn't always
  // reflect new fields immediately during standalone typecheck of
  // this module (a consumer-side `nuxi prepare` is what regenerates
  // it). Cast to a forward-compatible shape so this file builds in
  // isolation as well — at runtime the defu in module.ts always
  // populates these.
  const sp = config.openapeSp as unknown as Record<string, string | undefined>
  return {
    clientId: (sp.clientId || 'sp.example.com').trim(),
    openapeUrl: (sp.openapeUrl || '').trim(),
    spName: (sp.spName || 'OpenApe Service Provider').trim(),
    fallbackIdpUrl: (sp.fallbackIdpUrl || 'https://id.openape.at').trim(),
    // Default `/dashboard` matches the original hardcoded value so
    // existing SPs (chat) keep working. troop overrides to `/` via
    // its nuxt.config — see `openapeSp.postLoginRedirect`.
    postLoginRedirect: (sp.postLoginRedirect || '/dashboard').trim(),
  }
}

export async function saveFlowState(event: H3Event, state: string, flow: AuthFlowState) {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.openapeSp.sessionSecret,
    maxAge: 600,
  })
  await session.update({
    state,
    flow,
    exp: Date.now() + 10 * 60 * 1000,
  })
}

export async function getFlowState(event: H3Event, expectedState: string): Promise<AuthFlowState | null> {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.openapeSp.sessionSecret,
  })
  const data = session.data
  if (!data?.state) return null
  if (data.state !== expectedState) return null
  if ((data.exp as number) < Date.now()) return null
  return data.flow as AuthFlowState
}

export async function clearFlowState(event: H3Event) {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.openapeSp.sessionSecret,
  })
  await session.clear()
}
