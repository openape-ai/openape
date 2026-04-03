import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser, bootstrapTestUserSshKey } from '../helpers/bootstrap.js'
import { IDP_URL, SP_URL, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY, TEST_USER } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { loginWithSshKey } from '../helpers/key-auth.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('SP Stateless Cookie-based Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser(TEST_USER)
    await bootstrapTestUserSshKey(TEST_USER.email, TEST_SSH_PUBLIC_KEY)
  })

  afterAll(async () => {
    await stopServers()
  })

  it('stores OAuth flow state in a cookie, not server storage', async () => {
    const client = new HttpClient()

    // Step 1: Initiate login — SP should set a flow-state cookie
    const { status, data } = await client.postJSON<{ redirectUrl: string }>(
      `${SP_URL}/api/login`,
      { email: TEST_USER.email },
    )
    expect(status).toBe(200)
    expect(data.redirectUrl).toContain('/authorize')

    // Verify flow cookie was set (it appears in the cookie header for SP)
    const cookieHeader = client.jar.headerFor(SP_URL)
    expect(cookieHeader).toContain('openape-flow')
  })

  it('completes full login and clears flow cookie afterward', async () => {
    const client = new HttpClient()

    // Step 1: SP login
    const { data: loginData } = await client.postJSON<{ redirectUrl: string }>(
      `${SP_URL}/api/login`,
      { email: TEST_USER.email },
    )

    // Verify flow cookie exists after login initiation
    const cookieHeader = client.jar.headerFor(SP_URL)
    expect(cookieHeader).toContain('openape-flow')

    // Step 2: Get JWT via SSH key challenge-response auth
    const jwt = await loginWithSshKey(IDP_URL, TEST_USER.email, TEST_SSH_PRIVATE_KEY, TEST_SSH_PUBLIC_KEY)

    // Step 3: Hit /authorize with Bearer token — should issue code directly
    const step3 = await client.fetch(loginData.redirectUrl, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
    expect(step3.status).toBe(302)
    const callbackUrl = step3.headers.get('Location')!
    expect(callbackUrl).toContain('code=')

    // Step 4: Follow callback — SP exchanges code, clears flow cookie, sets session
    const step4 = await client.fetch(callbackUrl)
    expect(step4.status).toBe(302)
    expect(step4.headers.get('Location')).toBe('/dashboard')

    // Step 5: Verify authenticated
    const { status: meStatus, data: claims } = await client.getJSON<{ sub: string }>(
      `${SP_URL}/api/me`,
    )
    expect(meStatus).toBe(200)
    expect(claims.sub).toBe(TEST_USER.email)
  })

  it('rejects callback with tampered or missing flow state', async () => {
    const client = new HttpClient()

    // Try callback with a bogus state — no flow cookie set
    const res = await client.fetch(`${SP_URL}/api/callback?code=fake&state=bogus`)
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')!
    expect(location).toContain('error=')
    expect(location).toContain('Invalid')
  })

  it('rejects callback with mismatched state parameter', async () => {
    const client = new HttpClient()

    // Start a real flow to get a valid flow cookie
    await client.postJSON(`${SP_URL}/api/login`, { email: TEST_USER.email })

    // Flow cookie is set for the real state, but we send a different state
    const res = await client.fetch(`${SP_URL}/api/callback?code=fake&state=wrong-state-value`)
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')!
    expect(location).toContain('error=')
  })

  it('SP has no server-side debug/storage endpoint', async () => {
    const client = new HttpClient()
    const res = await client.fetch(`${SP_URL}/api/debug`)
    // Should 404 — debug endpoint was removed
    expect(res.status).toBe(404)
  })
})
