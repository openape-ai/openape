import { handleCallback } from '@ddisa/sp-server'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { code, state, error, error_description } = query as Record<string, string>
  const { spId } = getSpConfig()
  const flowStateStore = useFlowStateStore()
  const origin = getRequestURL(event).origin
  const redirectUri = `${origin}/api/callback`

  if (error) {
    const msg = error_description || error
    return sendRedirect(event, `/?error=${encodeURIComponent(msg)}`)
  }

  if (!code || !state) {
    return sendRedirect(event, `/?error=${encodeURIComponent('Missing code or state parameter')}`)
  }

  // Retrieve stored flow state
  const flowState = await flowStateStore.find(state)
  if (!flowState) {
    return sendRedirect(event, `/?error=${encodeURIComponent('Invalid or expired state — please try again')}`)
  }

  try {
    const result = await handleCallback({
      code,
      state,
      flowState,
      spId,
      redirectUri,
    })

    // Clean up flow state
    await flowStateStore.delete(state)

    // Save claims in session
    const session = await getSession(event)
    await session.update({
      claims: result.claims,
    })

    return sendRedirect(event, '/dashboard')
  }
  catch (err: unknown) {
    await flowStateStore.delete(state)
    const message = err instanceof Error ? err.message : 'Callback processing failed'
    return sendRedirect(event, `/?error=${encodeURIComponent(message)}`)
  }
})
