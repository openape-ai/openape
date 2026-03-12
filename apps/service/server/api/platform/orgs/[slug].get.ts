import { getOrg } from '../../../utils/org-store'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Slug required' })

  const org = await getOrg(slug)
  if (!org) throw createError({ statusCode: 404, statusMessage: 'Org not found' })

  return org
})
