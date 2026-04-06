import { introspectGrant } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const stores = await getStores()

  const id = getRouterParam(event, 'id')!

  const grant = await introspectGrant(id, stores.grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  const etag = `W/"${grant.status}:${grant.decided_at || grant.created_at}"`
  setResponseHeader(event, 'ETag', etag)

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    setResponseStatus(event, 304)
    return ''
  }

  return grant
})
