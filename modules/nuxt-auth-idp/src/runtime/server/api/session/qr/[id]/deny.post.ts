import { defineEventHandler, getRouterParam } from 'h3'
import { getAppSession } from '../../../../utils/session'
import { useGrantStorage } from '../../../../utils/grant-storage'
import { createProblemError } from '../../../../utils/problem'
import { QR_TOKEN_RE, qrChannelKey } from '../../../../utils/qr-login'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const id = getRouterParam(event, 'id') ?? ''
  if (!QR_TOKEN_RE.test(id)) {
    throw createProblemError({ status: 400, title: 'Malformed channel id' })
  }

  await useGrantStorage().removeItem(qrChannelKey(id))
  return { ok: true }
})
