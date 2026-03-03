import type { TokenExchangeParams } from '@openape/auth'
import { createError, defineEventHandler, readRawBody } from 'h3'
import { handleTokenExchange } from '@openape/auth'
import { useIdpStores, getIdpIssuer } from '../utils/stores'

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf-8')
  let body: TokenExchangeParams
  try {
    body = JSON.parse(rawBody || '{}')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }

  const { codeStore, keyStore } = useIdpStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.sp_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: grant_type, code, code_verifier, redirect_uri, sp_id',
    })
  }

  try {
    const result = await handleTokenExchange(body, codeStore, keyStore, getIdpIssuer())
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
