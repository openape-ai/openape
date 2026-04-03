import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../utils/admin'
import { useIdpStores } from '../../../../utils/stores'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const email = decodeURIComponent(getRouterParam(event, 'email') || '')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Email is required' })
  }

  const { sshKeyStore } = useIdpStores()
  return await sshKeyStore.findByUser(email)
})
