import type { TokenExchangeParams } from '@openape/auth'
import { createError, defineEventHandler, readRawBody } from 'h3'
import { handleTokenExchange } from '@openape/auth'
import { getIdpIssuer, useIdpStores } from '../utils/stores'

function parseScope(scope?: string): Set<string> {
  if (!scope) return new Set()
  return new Set(scope.split(/\s+/).filter(Boolean))
}

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf-8')
  let body: TokenExchangeParams
  try {
    body = JSON.parse(rawBody || '{}')
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
  const { codeStore, keyStore, userStore } = useIdpStores()

  if (!body.grant_type || !body.code || !body.code_verifier || !body.redirect_uri || !body.sp_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: grant_type, code, code_verifier, redirect_uri, sp_id',
    })
  }

  try {
    const result = await handleTokenExchange(body, codeStore, keyStore, getIdpIssuer(), async (userId, scope) => {
      const scopes = parseScope(scope)
      const claims: { email?: string, name?: string } = {}

      // If no scope specified, include all claims (backwards compatibility)
      // If scope is specified, only include what's requested
      const includeAll = scopes.size === 0
      const needsUser = includeAll || scopes.has('email') || scopes.has('profile')

      if (needsUser) {
        const user = await userStore.findByEmail(userId)
        if (user) {
          if (includeAll || scopes.has('email')) {
            claims.email = user.email
          }
          if (includeAll || scopes.has('profile')) {
            claims.name = user.name
          }
        }
      }

      return claims
    })
    return result
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
