import type { TokenExchangeParams } from '@ddisa/idp-server'
import { handleTokenExchange } from '@ddisa/idp-server'

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf-8')
  let body: TokenExchangeParams
  try {
    body = JSON.parse(rawBody || '{}')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
  const { codeStore, keyStore } = useStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.sp_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: grant_type, code, code_verifier, redirect_uri, sp_id',
    })
  }

  try {
    const result = await handleTokenExchange(body, codeStore, keyStore, IDP_ISSUER)
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
