export default defineEventHandler(async (event) => {
  const session = await getSpSession(event)
  const data = session.data as Record<string, unknown>
  const claims = data.claims as { sub?: string } | undefined

  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const body = await readBody<{ action?: string, reason?: string }>(event)
  const { clientId, openapeUrl } = getSpConfig()
  const origin = getRequestURL(event).origin

  // Create grant request on the IdP
  const grant = await $fetch<{ id: string }>(`${openapeUrl}/api/grants`, {
    method: 'POST',
    body: {
      requester: claims.sub,
      target_host: clientId,
      audience: clientId,
      grant_type: 'once',
      permissions: [body.action || 'protected-action'],
      reason: body.reason || 'User requested permission for protected action',
    },
  })

  // Build callback URL that the IdP will redirect back to after approval
  const callbackBase = `${origin}/api/grant-callback`

  // Build redirect URL to grant-approval page on IdP
  const approvalUrl = new URL(`${openapeUrl}/grant-approval`)
  approvalUrl.searchParams.set('grant_id', grant.id)
  approvalUrl.searchParams.set('callback', callbackBase)

  return { redirectUrl: approvalUrl.toString(), grantId: grant.id }
})
