import { introspectGrant } from '@openape/grants'
import { defineEventHandler, getRequestHeader, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const grant = await introspectGrant(id, grantStore)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // ETag for efficient polling
  const etag = `W/"${grant.status}:${grant.decided_at || grant.created_at}"`
  setResponseHeader(event, 'ETag', etag)

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  if (ifNoneMatch === etag) {
    setResponseStatus(event, 304)
    return ''
  }

  return grant
})
