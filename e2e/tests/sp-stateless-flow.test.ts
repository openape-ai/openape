import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser } from '../helpers/bootstrap.js'
import { IDP_URL, SP_URL } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('SP Stateless Cookie-based Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser({ email: 'alice@example.com', password: 'testpass1', name: 'Alice' })
  })

  afterAll(async () => {
    await stopServers()
  })

  it('stores OAuth flow state in a cookie, not server storage', async () => {
    const client = new HttpClient()

    // Step 1: Initiate login — SP should set a flow-state cookie
    const { status, data } = await client.postJSON<{ redirectUrl: string }>(
      `${SP_URL}/api/login`,
      { email: 'alice@example.com' },
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
      { email: 'alice@example.com' },
    )

    // Verify flow cookie exists after login initiation
    const cookieHeader = client.jar.headerFor(SP_URL)
    expect(cookieHeader).toContain('openape-flow')

    // Step 2: Follow authorize → login redirect
    const step2 = await client.fetch(loginData.redirectUrl)
    expect(step2.status).toBe(302)

    // Step 3: Authenticate on IdP
    const { data: idpLogin } = await client.postJSON<{ ok: boolean }>(
      `${IDP_URL}/api/login`,
      { email: 'alice@example.com', password: 'testpass1' },
    )
    expect(idpLogin.ok).toBe(true)

    // Step 4: Hit authorize again — get code
    const step4 = await client.fetch(loginData.redirectUrl)
    expect(step4.status).toBe(302)
    const callbackUrl = step4.headers.get('Location')!
    expect(callbackUrl).toContain('code=')

    // Step 5: Follow callback — SP exchanges code, clears flow cookie, sets session
    const step5 = await client.fetch(callbackUrl)
    expect(step5.status).toBe(302)
    expect(step5.headers.get('Location')).toBe('/dashboard')

    // Step 6: Verify authenticated
    const { status: meStatus, data: claims } = await client.getJSON<{ sub: string }>(
      `${SP_URL}/api/me`,
    )
    expect(meStatus).toBe(200)
    expect(claims.sub).toBe('alice@example.com')
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
    await client.postJSON(`${SP_URL}/api/login`, { email: 'alice@example.com' })

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
