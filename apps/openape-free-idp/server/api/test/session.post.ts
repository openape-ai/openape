import { createError, defineEventHandler, getHeader, readBody, useSession } from 'h3'

const RE_BEARER_PREFIX = /^Bearer\s+/i

export default defineEventHandler(async (event) => {
  if (process.env.OPENAPE_E2E !== '1') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const config = useRuntimeConfig()
  const auth = getHeader(event, 'authorization')
  const token = auth?.replace(RE_BEARER_PREFIX, '')
  if (!token || token !== config.openapeIdp.managementToken) {
    throw createError({ statusCode: 401, statusMessage: 'Management token required' })
  }

  const body = await readBody<{ email?: string }>(event)
  if (!body.email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email' })
  }

  const session = await useSession(event, {
    name: 'openape-idp',
    password: config.openapeIdp.sessionSecret,
  })

  await session.update({
    userId: body.email,
  })

  return { ok: true, email: body.email }
})
