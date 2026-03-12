import { defineEventHandler } from 'h3'
import { isAdmin } from '../utils/admin'
import { getAppSession } from '../utils/session'
import { createProblemError } from '../utils/problem'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)

  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  return {
    email: session.data.userId,
    name: session.data.userName,
    isAdmin: isAdmin(session.data.userId as string) || session.data.isSuperAdmin === true,
  }
})
