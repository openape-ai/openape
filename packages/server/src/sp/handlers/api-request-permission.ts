import type { EventHandler } from 'h3'
import { createError, defineEventHandler, getRequestURL, readBody, useSession } from 'h3'
import type { SPConfig } from '../config.js'
import { SESSION_SECRET } from './api-login.js'
import { SP_SESSION_NAME } from './api-callback.js'

export function createApiRequestPermissionHandler(config: SPConfig): EventHandler {
  return defineEventHandler(async (event) => {
    const session = await useSession(event, {
      name: SP_SESSION_NAME,
      password: SESSION_SECRET,
    })
    const data = session.data as Record<string, unknown>
    const claims = data.claims as { sub?: string } | undefined

    if (!claims?.sub) {
      throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
    }

    const body = await readBody<{ action?: string, reason?: string }>(event)
    const origin = getRequestURL(event).origin
    const idpUrl = config.idpUrl

    if (!idpUrl) {
      throw createError({ statusCode: 500, statusMessage: 'IdP URL not configured' })
    }

    // Create grant request on the IdP
    const grantRes = await fetch(`${idpUrl}/api/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester: claims.sub,
        target_host: config.clientId,
        audience: config.clientId,
        grant_type: 'once',
        permissions: [body.action || 'protected-action'],
        reason: body.reason || 'User requested permission for protected action',
      }),
    })

    if (!grantRes.ok) {
      const errText = await grantRes.text().catch(() => '')
      throw createError({ statusCode: grantRes.status, statusMessage: `Grant creation failed: ${errText}` })
    }

    const grant = await grantRes.json() as { id: string }

    // Build callback URL that the IdP will redirect back to after approval
    const callbackBase = `${origin}/api/grant-callback`

    // Build redirect URL to grant-approval page on IdP
    const approvalUrl = new URL(`${idpUrl}/grant-approval`)
    approvalUrl.searchParams.set('grant_id', grant.id)
    approvalUrl.searchParams.set('callback', callbackBase)

    return { redirectUrl: approvalUrl.toString(), grantId: grant.id }
  })
}
