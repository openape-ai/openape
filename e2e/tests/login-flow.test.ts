import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapTestUser } from '../helpers/bootstrap.js'
import { IDP_URL, SP_URL } from '../helpers/constants.js'
import { HttpClient } from '../helpers/http-client.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

describe('dDISA OIDC Login Flow', () => {
  beforeAll(async () => {
    await startServers()
    await bootstrapTestUser({ email: 'admin@example.com', password: 'q1w2e3r4', name: 'Admin User' })
  })

  afterAll(async () => {
    await stopServers()
  })

  it('completes the full login flow and returns authenticated user claims', async () => {
    const client = new HttpClient()

    // Step 1: SP login — discover IdP and get authorization URL
    const { status: loginStatus, data: loginData } = await client.postJSON<{
      redirectUrl: string
    }>(`${SP_URL}/api/login`, { email: 'admin@example.com' })

    expect(loginStatus).toBe(200)
    expect(loginData.redirectUrl).toContain(`${IDP_URL}/authorize`)

    const authorizeUrl = loginData.redirectUrl

    // Step 2: Follow IdP /authorize — not authenticated yet, redirects to /login
    const step2 = await client.fetch(authorizeUrl)
    expect(step2.status).toBe(302)

    const loginRedirect = step2.headers.get('Location')!
    expect(loginRedirect).toContain('/login?returnTo=')

    // Step 3: Authenticate on the IdP
    const { status: idpLoginStatus, data: idpLoginData } = await client.postJSON<{
      ok: boolean
    }>(`${IDP_URL}/api/login`, {
      email: 'admin@example.com',
      password: 'q1w2e3r4',
    })

    expect(idpLoginStatus).toBe(200)
    expect(idpLoginData.ok).toBe(true)

    // Step 4: Hit /authorize again — now authenticated, should issue code and redirect to SP callback
    const step4 = await client.fetch(authorizeUrl)
    expect(step4.status).toBe(302)

    const callbackRedirect = step4.headers.get('Location')!
    expect(callbackRedirect).toContain(`${SP_URL}/api/callback`)
    expect(callbackRedirect).toContain('code=')
    expect(callbackRedirect).toContain('state=')

    // Step 5: Follow SP callback — exchanges code for token, sets session, redirects to /dashboard
    const step5 = await client.fetch(callbackRedirect)
    expect(step5.status).toBe(302)
    expect(step5.headers.get('Location')).toBe('/dashboard')

    // Step 6: Fetch claims from SP /api/me
    const { status: meStatus, data: claims } = await client.getJSON<{
      sub: string
      iss: string
      aud: string
      nonce: string
    }>(`${SP_URL}/api/me`)

    expect(meStatus).toBe(200)
    expect(claims.sub).toBe('admin@example.com')
    expect(claims.iss).toBe(IDP_URL)
    expect(claims.aud).toBe('sp.example.com')
    expect(claims.nonce).toBeTruthy()
  })
})
