import { describe, expect, it } from 'vitest'
import type { ResolvedConfig } from '../config.js'
import { CookieJar, del, generateEd25519Key, post, sessionLogin, signChallenge } from '../helpers.js'

export function sessionTests(config: ResolvedConfig) {
  describe('Session Login/Logout', () => {
    const userEmail = `session-suite-${Date.now()}@example.com`
    const userKey = generateEd25519Key()

    it('setup: create user for session tests', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: userEmail,
          name: 'Session User',
          publicKey: userKey.publicKeySsh,
          owner: userEmail,
          type: 'human',
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('session login sets cookie', async () => {
      const cookies = await sessionLogin(config.baseUrl, userEmail, userKey.privateKey)
      expect(cookies.length).toBeGreaterThan(0)
    })

    it('cookie has HttpOnly and SameSite=Lax', async () => {
      const cookies = await sessionLogin(config.baseUrl, userEmail, userKey.privateKey)
      const cookie = cookies[0]!.toLowerCase()
      expect(cookie).toContain('httponly')
      expect(cookie).toContain('samesite=lax')
    })

    it('/api/session/login returns ok: true', async () => {
      const { data: challengeData } = await post(config.baseUrl, '/api/auth/challenge', { id: userEmail })
      const signature = signChallenge(challengeData.challenge, userKey.privateKey)
      const res = await fetch(`${config.baseUrl}/api/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userEmail,
          challenge: challengeData.challenge,
          signature,
        }),
      })
      expect(res.ok).toBe(true)
      const data = await res.json() as { ok: boolean }
      expect(data.ok).toBe(true)
    })

    it('session logout clears session', async () => {
      const jar = new CookieJar()

      // Login
      const { data: challengeData } = await post(config.baseUrl, '/api/auth/challenge', { id: userEmail })
      const signature = signChallenge(challengeData.challenge, userKey.privateKey)
      const loginRes = await fetch(`${config.baseUrl}/api/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userEmail,
          challenge: challengeData.challenge,
          signature,
        }),
      })
      expect(loginRes.ok).toBe(true)
      jar.capture(`${config.baseUrl}/api/session/login`, loginRes.headers.getSetCookie())

      const cookie = jar.headerFor(`${config.baseUrl}/api/session/logout`)
      expect(cookie).toBeTruthy()

      // Logout
      const logoutRes = await fetch(`${config.baseUrl}/api/session/logout`, {
        method: 'POST',
        headers: cookie ? { Cookie: cookie } : {},
      })
      expect(logoutRes.ok).toBe(true)
      jar.capture(`${config.baseUrl}/api/session/logout`, logoutRes.headers.getSetCookie())

      // Verify: authorize should redirect to login, not to callback
      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'session-logout-test')
      authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('scope', 'openid')

      const cookieAfterLogout = jar.headerFor(authorizeUrl.toString())
      const authRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: cookieAfterLogout ? { Cookie: cookieAfterLogout } : {},
      })
      expect(authRes.status).toBe(302)
      expect(authRes.headers.get('location')).toContain('/login?returnTo=')
    })

    it('cleanup: delete test user', async () => {
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(userEmail)}`, config.managementToken)
    })
  })
}
