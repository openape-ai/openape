import { denyGrant } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { requireGrantActionAuthority } from '../../../utils/grant-authority'
import { useGrantStores } from '../../../utils/grant-stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const email = await requireAuth(event)

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  await requireGrantActionAuthority(event, grant, email, 'deny')

  try {
    const denied = await denyGrant(id, email, grantStore)
    return denied
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to deny grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
