import type { H3Event } from 'h3'
import type { AuthFlowState } from '@openape/core'

const FLOW_COOKIE = 'openape-flow'

export function getSpConfig() {
  const config = useRuntimeConfig()
  return {
    spId: config.spId || 'sp.example.com',
    openapeUrl: config.openapeUrl || 'http://localhost:3000',
    spName: 'DDISA Sample SP',
  }
}

/**
 * Save OAuth flow state as a signed, httpOnly cookie.
 * Uses h3's useSession which encrypts + signs automatically.
 * No server-side storage needed — fully stateless.
 */
export async function saveFlowState(event: H3Event, state: string, flow: AuthFlowState) {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.sessionSecret,
    maxAge: 600, // 10 min
  })
  await session.update({
    state,
    flow,
    exp: Date.now() + 10 * 60 * 1000,
  })
}

/**
 * Retrieve and validate OAuth flow state from cookie.
 * Returns null if missing, expired, or state mismatch.
 */
export async function getFlowState(event: H3Event, expectedState: string): Promise<AuthFlowState | null> {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.sessionSecret,
  })
  const data = session.data
  if (!data?.state) return null
  if (data.state !== expectedState) return null
  if ((data.exp as number) < Date.now()) return null
  return data.flow as AuthFlowState
}

/**
 * Clear the flow state cookie after use.
 */
export async function clearFlowState(event: H3Event) {
  const config = useRuntimeConfig()
  const session = await useSession(event, {
    name: FLOW_COOKIE,
    password: config.sessionSecret,
  })
  await session.clear()
}
