import type { ActorType, DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import type { AuthorizeParams } from '@openape/auth'
import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { validateAuthorizeRequest } from '@openape/auth'
import { approveGrant, createGrant, useGrant, validateDelegation } from '@openape/grants'
import type { IdPConfig, IdPStores } from '../config.js'
import { createProblemError } from '../utils/problem.js'
import { verifyBearerAuth } from '../utils/bearer-auth.js'

function parseAuthorizationDetails(raw: string | undefined): OpenApeAuthorizationDetail[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d: unknown): d is OpenApeAuthorizationDetail =>
        typeof d === 'object'
        && d !== null
        && ['openape_grant', 'openape_cli'].includes(String((d as Record<string, unknown>).type ?? ''))
        && typeof (d as Record<string, unknown>).action === 'string',
    )
  }
  catch {
    return []
  }
}

export function createAuthorizeHandler(stores: IdPStores, config: IdPConfig) {
  return defineEventHandler(async (event) => {
    const query = getQuery(event)

    const params: AuthorizeParams = {
      client_id: String(query.client_id ?? ''),
      redirect_uri: String(query.redirect_uri ?? ''),
      state: String(query.state ?? ''),
      code_challenge: String(query.code_challenge ?? ''),
      code_challenge_method: String(query.code_challenge_method ?? ''),
      nonce: query.nonce ? String(query.nonce) : undefined,
      response_type: String(query.response_type ?? ''),
      scope: String(query.scope ?? ''),
    }

    const error = validateAuthorizeRequest(params)
    if (error) {
      if (params.redirect_uri) {
        try {
          const errorUrl = new URL(params.redirect_uri)
          errorUrl.searchParams.set('error', 'invalid_request')
          errorUrl.searchParams.set('error_description', error)
          if (params.state) {
            errorUrl.searchParams.set('state', params.state)
          }
          return sendRedirect(event, errorUrl.toString())
        }
        catch {
          // Invalid redirect_uri — fall through to createProblemError
        }
      }
      throw createProblemError({ status: 400, title: error })
    }

    // Standalone server: Bearer token only (no cookie sessions)
    const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
    if (!bearerPayload) {
      throw createProblemError({ status: 401, title: 'Bearer token required' })
    }

    let userId: string
    let actorType: ActorType | undefined
    let delegationAct: DelegationActClaim | undefined
    let delegationGrantId: string | undefined

    const delegationGrantParam = String(query.delegation_grant ?? '')

    if (delegationGrantParam) {
      const grant = await validateDelegation(
        delegationGrantParam,
        bearerPayload.sub,
        params.client_id,
        stores.grantStore,
      )
      userId = grant.request.delegator!
      delegationAct = { sub: bearerPayload.sub }
      delegationGrantId = grant.id
      await useGrant(grant.id, stores.grantStore)
    }
    else {
      userId = bearerPayload.sub
      actorType = bearerPayload.act === 'agent' ? 'agent' : undefined
    }

    // Parse and process authorization_details (RFC 9396)
    const authzDetails = parseAuthorizationDetails(String(query.authorization_details ?? ''))
    let approvedDetails: OpenApeAuthorizationDetail[] | undefined

    if (authzDetails.length > 0) {
      approvedDetails = []

      for (const detail of authzDetails) {
        const grant = await createGrant({
          requester: bearerPayload.sub,
          target_host: params.client_id,
          audience: params.client_id,
          grant_type: detail.approval ?? 'once',
          permissions: [detail.type === 'openape_cli' ? detail.permission : detail.action],
          ...(detail.type === 'openape_cli' ? { authorization_details: [detail] } : {}),
          reason: detail.reason,
        }, stores.grantStore)

        const approved = await approveGrant(grant.id, userId, stores.grantStore)
        approvedDetails.push({
          ...detail,
          grant_id: approved.id,
        })
      }
    }

    const code = crypto.randomUUID()
    await stores.codeStore.save({
      code,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      userId,
      nonce: params.nonce,
      expiresAt: Date.now() + 60_000,
      act: actorType,
      scope: params.scope || undefined,
      authorizationDetails: approvedDetails,
      delegationAct,
      delegationGrant: delegationGrantId,
    })

    const redirectUrl = new URL(params.redirect_uri)
    redirectUrl.searchParams.set('code', code)
    redirectUrl.searchParams.set('state', params.state)

    return sendRedirect(event, redirectUrl.toString())
  })
}
