import type { AuthorizeParams } from '@openape/auth'
import type { ActorType, DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import { createError, defineEventHandler, getQuery, getRequestURL, sendRedirect } from 'h3'
import { extractDomain, resolveDDISA } from '@openape/core'
import { evaluatePolicy, validateAuthorizeRequest } from '@openape/auth'
import { approveGrant, createGrant, useGrant, validateDelegation } from '@openape/grants'
import { tryAgentAuth } from '../utils/agent-auth'
import { getAppSession } from '../utils/session'
import { useIdpStores } from '../utils/stores'
import { useGrantStores } from '../utils/grant-stores'

function parseAuthorizationDetails(raw: string | undefined): OpenApeAuthorizationDetail[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (d: unknown): d is OpenApeAuthorizationDetail =>
        typeof d === 'object' && d !== null && (d as Record<string, unknown>).type === 'openape_grant' && typeof (d as Record<string, unknown>).action === 'string',
    )
  }
  catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { codeStore } = useIdpStores()

  const params: AuthorizeParams = {
    client_id: String(query.client_id ?? ''),
    redirect_uri: String(query.redirect_uri ?? ''),
    state: String(query.state ?? ''),
    code_challenge: String(query.code_challenge ?? ''),
    code_challenge_method: String(query.code_challenge_method ?? ''),
    nonce: String(query.nonce ?? ''),
    response_type: String(query.response_type ?? ''),
    scope: String(query.scope ?? ''),
  }

  const error = validateAuthorizeRequest(params)
  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  // Determine userId: Agent Bearer Token or Human Session
  const agentPayload = await tryAgentAuth(event)
  let userId: string
  let actorType: ActorType | undefined
  let delegationAct: DelegationActClaim | undefined
  let delegationGrantId: string | undefined

  // Check for explicit delegation_grant parameter
  const delegationGrantParam = String(query.delegation_grant ?? '')

  if (agentPayload) {
    if (delegationGrantParam) {
      // Agent with explicit delegation grant
      const { grantStore } = useGrantStores()
      const grant = await validateDelegation(
        delegationGrantParam,
        agentPayload.sub,
        params.client_id,
        grantStore,
      )
      // sub becomes the delegator, act becomes the delegate
      userId = grant.request.delegator!
      delegationAct = { sub: agentPayload.sub }
      delegationGrantId = grant.id
      // Consume grant (once → used, timed/always → noop)
      await useGrant(grant.id, grantStore)
    }
    else {
      // Standard agent mode
      userId = agentPayload.sub
      actorType = 'agent'
    }
  }
  else {
    const session = await getAppSession(event)
    const loginHint = String(query.login_hint ?? '')
    if (!session.data.userId || (loginHint && session.data.userId !== loginHint)) {
      const returnTo = `/authorize?${new URLSearchParams(query as Record<string, string>).toString()}`
      await session.update({ pendingAuthorize: params, returnTo })
      const loginUrl = new URL('/login', getRequestURL(event).origin)
      loginUrl.searchParams.set('returnTo', returnTo)
      if (loginHint) {
        loginUrl.searchParams.set('login_hint', loginHint)
      }
      return sendRedirect(event, loginUrl.pathname + loginUrl.search)
    }

    if (delegationGrantParam) {
      // Human with explicit delegation grant (e.g. Lisa acting as Patrick)
      const { grantStore } = useGrantStores()
      const grant = await validateDelegation(
        delegationGrantParam,
        session.data.userId,
        params.client_id,
        grantStore,
      )
      userId = grant.request.delegator!
      delegationAct = { sub: session.data.userId }
      delegationGrantId = grant.id
      await useGrant(grant.id, grantStore)
    }
    else {
      userId = session.data.userId
    }
  }

  const userDomain = extractDomain(userId)
  const ddisaRecord = await resolveDDISA(userDomain)
  const policyMode = ddisaRecord?.mode ?? 'open'
  const noopConsentStore = { hasConsent: async () => false, save: async () => {} }
  const decision = await evaluatePolicy(policyMode, params.client_id, userId, noopConsentStore)

  if (decision !== 'allow') {
    const redirectUrl = new URL(params.redirect_uri)
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('state', params.state)
    return sendRedirect(event, redirectUrl.toString())
  }

  // Parse and process authorization_details (RFC 9396)
  const authzDetails = parseAuthorizationDetails(String(query.authorization_details ?? ''))
  let approvedDetails: OpenApeAuthorizationDetail[] | undefined

  if (authzDetails.length > 0) {
    const { grantStore } = useGrantStores()
    approvedDetails = []

    for (const detail of authzDetails) {
      const grant = await createGrant({
        requester: agentPayload ? agentPayload.sub : userId,
        target: params.client_id,
        grant_type: detail.approval ?? 'once',
        permissions: [detail.action],
        reason: detail.reason,
      }, grantStore)

      // Auto-approve: user consents by authenticating in the authorize flow
      const approved = await approveGrant(grant.id, userId, grantStore)
      approvedDetails.push({
        ...detail,
        grant_id: approved.id,
      })
    }
  }

  const code = crypto.randomUUID()
  await codeStore.save({
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

  // Session cleanup only for human flow
  if (!agentPayload) {
    const session = await getAppSession(event)
    await session.update({ pendingAuthorize: undefined, returnTo: undefined })
  }

  return sendRedirect(event, redirectUrl.toString())
})
