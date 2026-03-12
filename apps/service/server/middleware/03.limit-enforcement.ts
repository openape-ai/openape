import type { H3Event } from 'h3'
import { getMethod } from 'h3'
import type { Org } from '../utils/org-store'
import { checkUserLimit, checkAgentLimit } from '../utils/limits'

export default defineEventHandler(async (event: H3Event) => {
  const org = event.context.org as Org | undefined
  if (!org) return

  const method = getMethod(event)
  const path = event.path

  // Only intercept POST requests that create users or agents
  if (method !== 'POST') return

  if (path === '/api/admin/users') {
    const idpStorage = useStorage(`tenant-idp-${org.slug}`)
    const userKeys = await idpStorage.getKeys('users:')
    checkUserLimit(org, userKeys.length)
  }

  if (path === '/api/admin/agents') {
    const idpStorage = useStorage(`tenant-idp-${org.slug}`)
    const agentKeys = await idpStorage.getKeys('agents:')
    checkAgentLimit(org, agentKeys.length)
  }
})
