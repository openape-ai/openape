import { verifyAuthzJWT, introspectGrant, useGrant } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const { token } = await readBody<{ token: string }>(event)

  if (!token) {
    return { valid: false, error: 'Missing token' }
  }

  const { keyStore, grantStore } = useStores()

  // Verify JWT signature with our own signing key
  const signingKey = await keyStore.getSigningKey()
  const result = await verifyAuthzJWT(token, {
    publicKey: signingKey.publicKey,
  })

  if (!result.valid) {
    return { valid: false, error: result.error }
  }

  const grantId = result.claims?.grant_id
  if (!grantId) {
    return { valid: false, error: 'Missing grant_id in token' }
  }

  // Load grant (auto-expires timed grants)
  const grant = await introspectGrant(grantId, grantStore)
  if (!grant) {
    return { valid: false, error: 'Grant not found' }
  }

  if (grant.status !== 'approved') {
    return { valid: false, error: `Grant is not approved (status: ${grant.status})` }
  }

  // For once-grants: mark as used
  if (grant.request.grant_type === 'once') {
    const used = await useGrant(grantId, grantStore)
    return { valid: true, claims: result.claims, grant: used }
  }

  return { valid: true, claims: result.claims, grant }
})
