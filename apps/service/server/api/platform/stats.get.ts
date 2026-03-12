import { requireTenant } from '../../utils/tenant'
import { getOrg } from '../../utils/org-store'

export default defineEventHandler(async (event) => {
  const slug = requireTenant(event)
  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })

  const idpStorage = useStorage(`tenant-idp-${slug}`)
  const grantsStorage = useStorage(`tenant-grants-${slug}`)

  const [userKeys, agentKeys, grantKeys] = await Promise.all([
    idpStorage.getKeys('users:'),
    idpStorage.getKeys('agents:'),
    grantsStorage.getKeys('grants:'),
  ])

  return {
    org: { name: org.name, slug: org.slug, plan: org.plan },
    stats: {
      users: userKeys.length,
      agents: agentKeys.length,
      grants: grantKeys.length,
    },
    limits: org.limits,
  }
})
