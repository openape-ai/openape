import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../../utils/admin'
import { useIdpStores } from '../../../../../utils/stores'
import { createProblemError } from '../../../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const keyId = getRouterParam(event, 'keyId')
  if (!keyId) {
    throw createProblemError({ status: 400, title: 'Key ID is required' })
  }

  const { sshKeyStore } = useIdpStores()

  const existing = await sshKeyStore.findById(keyId)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'SSH key not found' })
  }

  await sshKeyStore.delete(keyId)
  return { ok: true }
})
