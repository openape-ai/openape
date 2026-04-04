import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdPApp } from '../idp/app.js'
import { createSPApp } from '../sp/app.js'
import type { SPConfig } from '../sp/config.js'

// ---------- helpers ----------

function generateEd25519SshKey(): { publicKey: string, privateKey: import('node:crypto').KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPub = publicKey.export({ type: 'spki', format: 'der' })
  const rawKey = rawPub.subarray(12)

  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const typeLen = Buffer.alloc(4)
  typeLen.writeUInt32BE(typeBuf.length)
  const keyLen = Buffer.alloc(4)
  keyLen.writeUInt32BE(rawKey.length)
  const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, rawKey])

  return {
    publicKey: `ssh-ed25519 ${wireFormat.toString('base64')}`,
    privateKey,
  }
}

function signChallenge(challenge: string, privateKey: import('node:crypto').KeyObject): string {
  const sig = sign(null, Buffer.from(challenge), privateKey)
  return sig.toString('base64')
}

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      }
      else {
        reject(new Error('Failed to get server address'))
      }
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

/**
 * Simple per-origin cookie jar for tests.
 * Captures Set-Cookie headers from responses and sends Cookie headers on requests.
 */
class CookieJar {
  private store = new Map<string, Map<string, string>>()

  capture(url: string, response: Response): void {
    const origin = new URL(url).origin
    const cookies = response.headers.getSetCookie()
    if (!cookies.length) return

    let originJar = this.store.get(origin)
    if (!originJar) {
      originJar = new Map()
      this.store.set(origin, originJar)
    }

    for (const cookie of cookies) {
      const [nameValue] = cookie.split(';')
      const eqIndex = nameValue!.indexOf('=')
      if (eqIndex === -1) continue
      const name = nameValue!.slice(0, eqIndex).trim()
      const value = nameValue!.slice(eqIndex + 1).trim()
      originJar.set(name, value)
    }
  }

  headerFor(url: string): string | undefined {
    const origin = new URL(url).origin
    const originJar = this.store.get(origin)
    if (!originJar || originJar.size === 0) return undefined
    return Array.from(originJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  clear(): void {
    this.store.clear()
  }
}

// ---------- Tests ----------

describe('Browser OIDC redirect flow (session-based)', () => {
  let idpServer: Server
  let spServer: Server
  let idpPort: number
  let spPort: number
  let idpBase: string
  let spBase: string
  const MGMT_TOKEN = 'test-mgmt-token'
  const SESSION_SECRET = 'test-session-secret-at-least-32-characters!'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    // Step 1: Start IdP and SP on free ports to learn the port numbers
    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN, sessionSecret: SESSION_SECRET })
    const tempIdpServer = createServer(toNodeListener(tempIdp.app))
    idpPort = await listenOnFreePort(tempIdpServer)
    await closeServer(tempIdpServer)

    const tempSp = createSPApp({ clientId: 'sp.example.com', redirectUri: 'http://placeholder/callback' })
    const tempSpServer = createServer(toNodeListener(tempSp.app))
    spPort = await listenOnFreePort(tempSpServer)
    await closeServer(tempSpServer)

    // Step 2: Recreate both with correct URLs
    idpBase = `http://127.0.0.1:${idpPort}`
    spBase = `http://127.0.0.1:${spPort}`

    const idpInstance = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: ['admin@example.com'],
      sessionSecret: SESSION_SECRET,
    })
    idpServer = createServer(toNodeListener(idpInstance.app))
    await new Promise<void>((resolve, reject) => {
      idpServer.listen(idpPort, '127.0.0.1', () => resolve())
      idpServer.on('error', reject)
    })

    const spConfig: SPConfig = {
      clientId: 'sp.example.com',
      redirectUri: `${spBase}/api/callback`,
      spName: 'Test SP',
      resolverOptions: {
        mockRecords: {
          'example.com': { idp: idpBase, mode: 'open' },
        },
      },
    }
    const spInstance = createSPApp(spConfig)
    spServer = createServer(toNodeListener(spInstance.app))
    await new Promise<void>((resolve, reject) => {
      spServer.listen(spPort, '127.0.0.1', () => resolve())
      spServer.on('error', reject)
    })

    // Step 3: Enroll user
    const enrollRes = await fetch(`${idpBase}/api/auth/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({
        email: 'alice@example.com',
        name: 'Alice',
        publicKey: userKey.publicKey,
        owner: 'admin@example.com',
      }),
    })
    if (!enrollRes.ok) {
      throw new Error(`Enroll failed: ${enrollRes.status} ${await enrollRes.text()}`)
    }
  })

  afterAll(async () => {
    await closeServer(idpServer)
    await closeServer(spServer)
  })

  it('full redirect chain: SP login → IdP authorize (no session) → login → session login → authorize (with session) → SP callback → me', async () => {
    const jar = new CookieJar()

    // 1. SP: POST /api/login → { redirectUrl: "http://idp/authorize?..." }
    const loginUrl = `${spBase}/api/login`
    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    })
    expect(loginRes.ok).toBe(true)
    jar.capture(loginUrl, loginRes)
    const loginData = await loginRes.json() as { redirectUrl: string }
    expect(loginData.redirectUrl).toContain('/authorize')

    // 2. Follow authorize URL (no session yet) → 302 to /login?returnTo=...
    const authRes = await fetch(loginData.redirectUrl, { redirect: 'manual' })
    expect(authRes.status).toBe(302)
    const loginLocation = authRes.headers.get('location')!
    expect(loginLocation).toContain('/login?returnTo=')
    jar.capture(loginData.redirectUrl, authRes)

    // 3. GET /login (the login page handler) — verify it returns the returnTo param
    const loginPageUrl = `${idpBase}${loginLocation}`
    const loginPageRes = await fetch(loginPageUrl)
    expect(loginPageRes.ok).toBe(true)
    const loginPageData = await loginPageRes.json() as { loginRequired: boolean, returnTo: string }
    expect(loginPageData.loginRequired).toBe(true)
    expect(loginPageData.returnTo).toContain('/authorize')

    // 4. Challenge-response login at IdP, setting session cookie
    // 4a: Get a challenge
    const challengeUrl = `${idpBase}/api/auth/challenge`
    const challengeRes = await fetch(challengeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com' }),
    })
    expect(challengeRes.ok).toBe(true)
    const challengeData = await challengeRes.json() as { challenge: string }
    expect(challengeData.challenge).toBeTruthy()

    // 4b: Sign the challenge and session-login
    const signature = signChallenge(challengeData.challenge, userKey.privateKey)
    const sessionLoginUrl = `${idpBase}/api/session/login`
    const sessionLoginRes = await fetch(sessionLoginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'alice@example.com',
        challenge: challengeData.challenge,
        signature,
      }),
    })
    expect(sessionLoginRes.ok).toBe(true)
    const sessionLoginData = await sessionLoginRes.json() as { ok: boolean }
    expect(sessionLoginData.ok).toBe(true)
    // Capture the session cookie from the IdP
    jar.capture(sessionLoginUrl, sessionLoginRes)

    // 5. Follow authorize URL again (WITH session cookie this time)
    const idpCookie = jar.headerFor(loginData.redirectUrl)
    expect(idpCookie).toBeTruthy()
    const authRes2 = await fetch(loginData.redirectUrl, {
      redirect: 'manual',
      headers: { Cookie: idpCookie! },
    })
    expect(authRes2.status).toBe(302)
    jar.capture(loginData.redirectUrl, authRes2)
    const callbackLocation = authRes2.headers.get('location')!
    expect(callbackLocation).toContain('code=')
    expect(callbackLocation).toContain('state=')

    // 6. SP /api/callback — exchanges code for assertion, sets SP session, redirects to /dashboard
    const spCookie = jar.headerFor(callbackLocation)
    const callbackHeaders: Record<string, string> = {}
    if (spCookie) callbackHeaders.Cookie = spCookie
    const callbackRes = await fetch(callbackLocation, {
      redirect: 'manual',
      headers: callbackHeaders,
    })
    expect(callbackRes.status).toBe(302)
    expect(callbackRes.headers.get('location')).toBe('/dashboard')
    jar.capture(callbackLocation, callbackRes)

    // 7. SP /api/me (with SP session cookie) → returns user claims
    const meUrl = `${spBase}/api/me`
    const spSessionCookie = jar.headerFor(meUrl)
    expect(spSessionCookie).toBeTruthy()
    const meRes = await fetch(meUrl, {
      headers: { Cookie: spSessionCookie! },
    })
    expect(meRes.ok).toBe(true)
    const meData = await meRes.json() as { sub: string, iss: string, aud: string }
    expect(meData.sub).toBe('alice@example.com')
    expect(meData.iss).toBe(idpBase)
    expect(meData.aud).toBe('sp.example.com')
  })

  it('authorize without session redirects to login', async () => {
    // Direct hit to /authorize with valid params but no Bearer and no session
    const url = new URL(`${idpBase}/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', 'sp.example.com')
    url.searchParams.set('redirect_uri', `${spBase}/api/callback`)
    url.searchParams.set('state', 'test-state')
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('scope', 'openid')

    const res = await fetch(url.toString(), { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('/login?returnTo=')
    // The returnTo should contain the original authorize params
    const returnTo = decodeURIComponent(location.split('returnTo=')[1]!)
    expect(returnTo).toContain('client_id=sp.example.com')
  })

  it('session logout clears session', async () => {
    const localJar = new CookieJar()

    // 1. Login with session
    const challengeRes = await fetch(`${idpBase}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com' }),
    })
    const { challenge } = await challengeRes.json() as { challenge: string }
    const signature = signChallenge(challenge, userKey.privateKey)

    const sessionLoginUrl = `${idpBase}/api/session/login`
    const loginRes = await fetch(sessionLoginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com', challenge, signature }),
    })
    expect(loginRes.ok).toBe(true)
    localJar.capture(sessionLoginUrl, loginRes)

    // 2. Verify /authorize works with session
    const authorizeUrl = new URL(`${idpBase}/authorize`)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', 'sp.example.com')
    authorizeUrl.searchParams.set('redirect_uri', `${spBase}/api/callback`)
    authorizeUrl.searchParams.set('state', 'test-state-logout')
    authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('scope', 'openid')

    const idpCookie = localJar.headerFor(authorizeUrl.toString())
    const authRes = await fetch(authorizeUrl.toString(), {
      redirect: 'manual',
      headers: { Cookie: idpCookie! },
    })
    // With session: should redirect to SP callback with code
    expect(authRes.status).toBe(302)
    expect(authRes.headers.get('location')).toContain('code=')

    // 3. Logout
    const logoutUrl = `${idpBase}/api/session/logout`
    const logoutRes = await fetch(logoutUrl, {
      method: 'POST',
      headers: { Cookie: idpCookie! },
    })
    expect(logoutRes.ok).toBe(true)
    localJar.capture(logoutUrl, logoutRes)

    // 4. Verify /authorize now redirects to login (session cleared)
    const idpCookieAfterLogout = localJar.headerFor(authorizeUrl.toString())
    const authRes2 = await fetch(authorizeUrl.toString(), {
      redirect: 'manual',
      headers: idpCookieAfterLogout ? { Cookie: idpCookieAfterLogout } : {},
    })
    expect(authRes2.status).toBe(302)
    expect(authRes2.headers.get('location')).toContain('/login?returnTo=')
  })

  it('existing Bearer token flow still works alongside session support', async () => {
    // Verify the existing Bearer token flow is unbroken
    // 1. Authenticate with Bearer token
    const challengeRes = await fetch(`${idpBase}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com' }),
    })
    const { challenge } = await challengeRes.json() as { challenge: string }
    const signature = signChallenge(challenge, userKey.privateKey)

    const authRes = await fetch(`${idpBase}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com', challenge, signature }),
    })
    expect(authRes.ok).toBe(true)
    const { token } = await authRes.json() as { token: string }

    // 2. Hit /authorize with Bearer token (no session)
    const authorizeUrl = new URL(`${idpBase}/authorize`)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', 'sp.example.com')
    authorizeUrl.searchParams.set('redirect_uri', `${spBase}/api/callback`)
    authorizeUrl.searchParams.set('state', 'bearer-test-state')
    authorizeUrl.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('scope', 'openid')

    const res = await fetch(authorizeUrl.toString(), {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toContain('code=')
    expect(location).toContain('state=bearer-test-state')
  })
})
