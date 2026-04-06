import { useSession } from 'h3'
import { getSessionConfig } from '../utils/session'

export default defineEventHandler(async (event) => {
  const config = getIdPConfig()
  const session = await useSession(event, getSessionConfig(config))

  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const stores = await getStores()
  const user = await stores.userStore.findByEmail(session.data.userId as string)

  const adminEmails = config.adminEmails ?? []
  const isAdmin = adminEmails.includes(session.data.userId as string)

  return {
    email: session.data.userId,
    name: user?.name ?? session.data.userId,
    isAdmin,
  }
})
