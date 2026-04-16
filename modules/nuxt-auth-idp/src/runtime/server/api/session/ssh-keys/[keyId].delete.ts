import { defineEventHandler, getRouterParam } from 'h3'
import { getAppSession } from '../../../utils/session'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const email = session.data.userId as string | undefined
  if (!email) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const keyId = decodeURIComponent(getRouterParam(event, 'keyId') || '')
  if (!keyId) {
    throw createProblemError({ status: 400, title: 'Key ID is required' })
  }

  const { sshKeyStore } = useIdpStores()
  const key = await sshKeyStore.findById(keyId)
  if (!key || key.userEmail !== email) {
    throw createProblemError({ status: 404, title: 'SSH key not found' })
  }

  await sshKeyStore.delete(keyId)
  return { ok: true }
})
