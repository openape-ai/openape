export default defineEventHandler(async (event) => {
  const session = await getSession(event)
  const data = session.data as Record<string, unknown>
  const claims = data.claims as { sub?: string } | undefined

  if (!claims?.sub) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const body = await readBody<{ action?: string; reason?: string }>(event)
  const { spId, clawgateUrl } = getSpConfig()
  const origin = getRequestURL(event).origin

  // Create grant request on the ClawGate (id-server)
  const grant = await $fetch<{ id: string }>(`${clawgateUrl}/api/grants`, {
    method: 'POST',
    body: {
      requester: claims.sub,
      target: spId,
      grant_type: 'once',
      permissions: [body.action || 'protected-action'],
      reason: body.reason || 'User requested permission for protected action',
    },
  })

  // Build callback URL that the IdP will redirect back to after approval
  const callbackBase = `${origin}/api/grant-callback`

  // Build redirect URL to grant-approval page on id-server
  const approvalUrl = new URL(`${clawgateUrl}/grant-approval`)
  approvalUrl.searchParams.set('grant_id', grant.id)
  approvalUrl.searchParams.set('callback', callbackBase)

  return { redirectUrl: approvalUrl.toString(), grantId: grant.id }
})
