import { defineEventHandler, getRouterParam } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const userId = await requireAuth(event)
  const credentialId = getRouterParam(event, 'id')
  if (!credentialId) {
    throw createProblemError({ status: 400, title: 'Missing credential ID' })
  }

  const { credentialStore } = useIdpStores()

  const credential = await credentialStore.findById(credentialId)
  if (!credential || credential.userEmail !== userId) {
    throw createProblemError({ status: 404, title: 'Credential not found' })
  }

  // Prevent deleting the last credential
  const allCredentials = await credentialStore.findByUser(userId)
  if (allCredentials.length <= 1) {
    throw createProblemError({ status: 400, title: 'Cannot delete the last credential' })
  }

  await credentialStore.delete(credentialId)
  return { ok: true }
})
