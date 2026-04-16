import { defineEventHandler } from 'h3'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const email = session.data.userId as string | undefined
  if (!email) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const { sshKeyStore } = useIdpStores()
  return await sshKeyStore.findByUser(email)
})
