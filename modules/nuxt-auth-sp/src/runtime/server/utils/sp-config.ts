import type { H3Event } from 'h3'
import { useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { AuthFlowState } from '@openape/core'

const FLOW_COOKIE = 'openape-flow'

export function getSpConfig() {
  const config = useRuntimeConfig()
  return {
    clientId: (config.openapeSp.clientId || 'sp.example.com').trim(),
    openapeUrl: (config.openapeSp.openapeUrl || '').trim(),
    spName: (config.openapeSp.spName || 'OpenApe Service Provider').trim(),
    fallbackIdpUrl: (config.openapeSp.fallbackIdpUrl || 'https://id.openape.at').trim(),
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
