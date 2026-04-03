import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser, bootstrapTestUserSshKey } from '../helpers/bootstrap.js'
import { IDP_URL, SP_ID, SP_URL, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { loginWithSshKey } from '../helpers/key-auth.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('dDISA OIDC Login Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
    await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)
  })

  afterAll(async () => {
    await stopServers()
  })

  it('completes the full login flow and returns authenticated user claims', async () => {
    const client = new HttpClient()

    // Step 1: SP login — discover IdP and get authorization URL
    const { status: loginStatus, data: loginData } = await client.postJSON<{
      redirectUrl: string
    }>(`${SP_URL}/api/login`, { email: TEST_USER.email })

    expect(loginStatus).toBe(200)
    expect(loginData.redirectUrl).toContain(`${IDP_URL}/authorize`)

    // Step 2: Get JWT via SSH key challenge-response auth
    const jwt = await loginWithSshKey(IDP_URL, TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)

    // Step 3: Hit /authorize with Bearer token — should issue code directly (no login redirect)
    const authorizeUrl = loginData.redirectUrl
    const authRes = await client.fetch(authorizeUrl, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(authRes.status).toBe(302)

    const callbackRedirect = authRes.headers.get('Location')!
    expect(callbackRedirect).toContain(`${SP_URL}/api/callback`)
    expect(callbackRedirect).toContain('code=')
    expect(callbackRedirect).toContain('state=')

    // Step 4: Follow SP callback — exchanges code for token, sets session, redirects to /dashboard
    const step4 = await client.fetch(callbackRedirect)
    expect(step4.status).toBe(302)
    expect(step4.headers.get('Location')).toBe('/dashboard')

    // Step 5: Fetch claims from SP /api/me
    const { status: meStatus, data: claims } = await client.getJSON<{
      sub: string
      iss: string
      aud: string
      nonce: string
    }>(`${SP_URL}/api/me`)

    expect(meStatus).toBe(200)
    expect(claims.sub).toBe(TEST_USER.email)
    expect(claims.iss).toBe(IDP_URL)
    expect(claims.aud).toBe(SP_ID)
    expect(claims.nonce).toBeTruthy()
  })
})
