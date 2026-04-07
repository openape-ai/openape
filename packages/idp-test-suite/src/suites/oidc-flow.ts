import { describe, expect, it } from 'vitest'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import type { ResolvedConfig } from '../config.js'
import { CookieJar, del, generateEd25519Key, loginWithKey, post, signChallenge } from '../helpers.js'

export function oidcFlowTests(config: ResolvedConfig) {
  describe('OIDC Authorization Flow', () => {
    const userEmail = `oidc-suite-${Date.now()}@example.com`
    const userKey = generateEd25519Key()

    it('setup: create user for OIDC tests', async () => {
      const { status } = await post(
        config.baseUrl,
        '/api/auth/enroll',
        {
          email: userEmail,
          name: 'OIDC User',
          publicKey: userKey.publicKeySsh,
          owner: userEmail,
          type: 'human',
        },
        config.managementToken,
      )
      expect(status).toBe(200)
    })

    it('authorize without auth redirects to /login', async () => {
      const url = new URL(`${config.baseUrl}/authorize`)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', 'sp.example.com')
      url.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      url.searchParams.set('state', 'oidc-noauth')
      url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('scope', 'openid')

      const res = await fetch(url.toString(), { redirect: 'manual' })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('/login?returnTo=')
    })

    it('authorize with Bearer token redirects with code', async () => {
      const token = await loginWithKey(config.baseUrl, userEmail, userKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const url = new URL(`${config.baseUrl}/authorize`)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', 'sp.example.com')
      url.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      url.searchParams.set('state', 'oidc-bearer')
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('scope', 'openid')

      const res = await fetch(url.toString(), {
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('code=')
      expect(location).toContain('state=oidc-bearer')
    })

    it('token exchange with PKCE returns assertion JWT', async () => {
      const token = await loginWithKey(config.baseUrl, userEmail, userKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'oidc-token')
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('scope', 'openid')

      const authorizeRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}` },
      })
      const location = authorizeRes.headers.get('location')!
      const code = new URL(location).searchParams.get('code')!
      expect(code).toBeDefined()

      const { status, data } = await post(config.baseUrl, '/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(status).toBe(200)
      expect(data.assertion).toBeDefined()
      expect(data.access_token).toBeDefined()
      expect(data.id_token).toBeDefined()
      expect(data.token_type).toBe('Bearer')
      expect(data.expires_in).toBeDefined()
    })

    it('assertion JWT has correct structure (base64-decodable)', async () => {
      const token = await loginWithKey(config.baseUrl, userEmail, userKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'oidc-claims')
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('scope', 'openid')

      const authorizeRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}` },
      })
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const { data } = await post(config.baseUrl, '/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })

      // Decode JWT payload (no verification here -- just structure check)
      const parts = data.assertion.split('.')
      expect(parts.length).toBe(3)
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      expect(payload.sub).toBe(userEmail)
      expect(payload.iss).toBeDefined()
      expect(payload.aud).toBe('sp.example.com')
    })

    it('authorize with session cookie redirects with code', async () => {
      const jar = new CookieJar()

      // Session login
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

      // Authorize with session cookie
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'oidc-session')
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')
      authorizeUrl.searchParams.set('scope', 'openid')

      const cookie = jar.headerFor(authorizeUrl.toString())
      expect(cookie).toBeTruthy()

      const authRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: { Cookie: cookie! },
      })
      expect(authRes.status).toBe(302)
      expect(authRes.headers.get('location')).toContain('code=')
    })

    it('rejects invalid authorization code', async () => {
      const { data } = await post(config.baseUrl, '/token', {
        grant_type: 'authorization_code',
        code: 'invalid-code-value',
        code_verifier: 'x',
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(data.error).toBe('invalid_grant')
    })

    it('rejects wrong PKCE verifier', async () => {
      const token = await loginWithKey(config.baseUrl, userEmail, userKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'oidc-bad-pkce')
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')

      const authorizeRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}` },
      })
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const { data } = await post(config.baseUrl, '/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-not-matching',
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(data.error).toBe('invalid_grant')
    })

    it('code replay protection: second exchange fails', async () => {
      const token = await loginWithKey(config.baseUrl, userEmail, userKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeUrl = new URL(`${config.baseUrl}/authorize`)
      authorizeUrl.searchParams.set('response_type', 'code')
      authorizeUrl.searchParams.set('client_id', 'sp.example.com')
      authorizeUrl.searchParams.set('redirect_uri', 'http://sp.example.com/callback')
      authorizeUrl.searchParams.set('state', 'oidc-replay')
      authorizeUrl.searchParams.set('code_challenge', codeChallenge)
      authorizeUrl.searchParams.set('code_challenge_method', 'S256')

      const authorizeRes = await fetch(authorizeUrl.toString(), {
        redirect: 'manual',
        headers: { Authorization: `Bearer ${token}` },
      })
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const tokenBody = {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }

      // First exchange succeeds
      const { status: s1 } = await post(config.baseUrl, '/token', tokenBody)
      expect(s1).toBe(200)

      // Second exchange fails
      const { data: d2 } = await post(config.baseUrl, '/token', tokenBody)
      expect(d2.error).toBe('invalid_grant')
    })

    it('cleanup: delete test user', async () => {
      await del(config.baseUrl, `/api/admin/users/${encodeURIComponent(userEmail)}`, config.managementToken)
    })
  })
}
