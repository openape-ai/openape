import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { HttpClient } from '../helpers/http-client.js'
import { startServers, stopServers } from '../helpers/server-manager.js'

const SP = 'http://localhost:3001'
const IDP = 'http://localhost:3000'

describe('DDISA OIDC Login Flow', () => {
  beforeAll(async () => {
    await startServers()
  })

  afterAll(async () => {
    await stopServers()
  })

  it('completes the full login flow and returns authenticated user claims', async () => {
    const client = new HttpClient()

    // Step 1: SP login — discover IdP and get authorization URL
    const { status: loginStatus, data: loginData } = await client.postJSON<{
      redirectUrl: string
    }>(`${SP}/api/login`, { email: 'user@example.com' })

    expect(loginStatus).toBe(200)
    expect(loginData.redirectUrl).toContain(`${IDP}/authorize`)

    const authorizeUrl = loginData.redirectUrl

    // Step 2: Follow IdP /authorize — not authenticated yet, redirects to /login
    const step2 = await client.fetch(authorizeUrl)
    expect(step2.status).toBe(302)

    const loginRedirect = step2.headers.get('Location')!
    expect(loginRedirect).toContain('/login?returnTo=')

    // Step 3: Authenticate on the IdP
    const { status: idpLoginStatus, data: idpLoginData } = await client.postJSON<{
      ok: boolean
    }>(`${IDP}/api/login`, {
      email: 'user@example.com',
      password: 'q1w2e3r4',
    })

    expect(idpLoginStatus).toBe(200)
    expect(idpLoginData.ok).toBe(true)

    // Step 4: Hit /authorize again — now authenticated, should issue code and redirect to SP callback
    const step4 = await client.fetch(authorizeUrl)
    expect(step4.status).toBe(302)

    const callbackRedirect = step4.headers.get('Location')!
    expect(callbackRedirect).toContain(`${SP}/api/callback`)
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
    }>(`${SP}/api/me`)

    expect(meStatus).toBe(200)
    expect(claims.sub).toBe('user@example.com')
    expect(claims.iss).toBe('http://localhost:3000')
    expect(claims.aud).toBe('localhost:3001')
    expect(claims.nonce).toBeTruthy()
  })
})
