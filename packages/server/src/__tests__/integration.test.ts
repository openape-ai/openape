import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { WELL_KNOWN_OAUTH_CLIENT_METADATA } from '@openape/core'
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

// ---------- Tests ----------

describe('IdP + SP integration', () => {
  let idpServer: Server
  let spServer: Server
  let idpPort: number
  let spPort: number
  const MGMT_TOKEN = 'test-mgmt-token'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    // Step 1: Start IdP and SP on free ports to learn the port numbers
    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempIdpServer = createServer(toNodeListener(tempIdp.app))
    idpPort = await listenOnFreePort(tempIdpServer)
    await closeServer(tempIdpServer)

    const tempSp = createSPApp({ clientId: 'sp.example.com', redirectUri: 'http://placeholder/callback' })
    const tempSpServer = createServer(toNodeListener(tempSp.app))
    spPort = await listenOnFreePort(tempSpServer)
    await closeServer(tempSpServer)

    // Step 2: Recreate both with correct URLs
    const idpInstance = createIdPApp({
      issuer: `http://127.0.0.1:${idpPort}`,
      managementToken: MGMT_TOKEN,
      adminEmails: ['admin@example.com'],
    })
    idpServer = createServer(toNodeListener(idpInstance.app))
    await new Promise<void>((resolve, reject) => {
      idpServer.listen(idpPort, '127.0.0.1', () => resolve())
      idpServer.on('error', reject)
    })

    const spConfig: SPConfig = {
      clientId: 'sp.example.com',
      redirectUri: `http://127.0.0.1:${spPort}/callback`,
      spName: 'Test SP',
      resolverOptions: {
        mockRecords: {
          'example.com': { idp: `http://127.0.0.1:${idpPort}`, mode: 'open' },
        },
      },
    }
    const spInstance = createSPApp(spConfig)
    spServer = createServer(toNodeListener(spInstance.app))
    await new Promise<void>((resolve, reject) => {
      spServer.listen(spPort, '127.0.0.1', () => resolve())
      spServer.on('error', reject)
    })

    // Step 3: Enroll user on IdP with SSH key (requires publicKey + owner)
    const idpBase = `http://127.0.0.1:${idpPort}`
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

  it('completes the full OIDC flow: login → authorize → callback → me', async () => {
    const idpBase = `http://127.0.0.1:${idpPort}`
    const spBase = `http://127.0.0.1:${spPort}`

    // Step 1: SP /login — discover IdP via mock DNS, get authorization URL
    const loginRes = await fetch(`${spBase}/login?email=alice@example.com`)
    expect(loginRes.ok).toBe(true)
    const loginData = await loginRes.json() as { redirectUrl: string }
    expect(loginData.redirectUrl).toBeDefined()
    expect(loginData.redirectUrl).toContain('/authorize')

    // Verify the authorization URL has correct params
    const authUrl = new URL(loginData.redirectUrl)
    expect(authUrl.searchParams.get('response_type')).toBe('code')
    expect(authUrl.searchParams.get('client_id')).toBe('sp.example.com')
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    const state = authUrl.searchParams.get('state')!

    // Step 2: Authenticate with the IdP using SSH challenge-response
    // 2a: Get a challenge (uses `id` field)
    const challengeRes = await fetch(`${idpBase}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'alice@example.com' }),
    })
    expect(challengeRes.ok).toBe(true)
    const challengeData = await challengeRes.json() as { challenge: string }
    expect(challengeData.challenge).toBeTruthy()

    // 2b: Sign the challenge and authenticate
    const signature = signChallenge(challengeData.challenge, userKey.privateKey)
    const authRes = await fetch(`${idpBase}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'alice@example.com',
        challenge: challengeData.challenge,
        signature,
      }),
    })
    expect(authRes.ok).toBe(true)
    const authData = await authRes.json() as { token: string }
    expect(authData.token).toBeTruthy()

    // Step 3: Hit IdP /authorize with the Bearer token
    // The IdP does a 302 redirect — we follow manually to extract code + state
    const authorizeRes = await fetch(loginData.redirectUrl, {
      headers: { Authorization: `Bearer ${authData.token}` },
      redirect: 'manual',
    })
    expect(authorizeRes.status).toBe(302)
    const location = authorizeRes.headers.get('location')!
    expect(location).toBeTruthy()

    const redirectParams = new URL(location)
    const code = redirectParams.searchParams.get('code')!
    const returnedState = redirectParams.searchParams.get('state')!
    expect(code).toBeTruthy()
    expect(returnedState).toBe(state)

    // Step 4: SP /callback — exchange code for assertion + get session
    const callbackRes = await fetch(`${spBase}/callback?code=${code}&state=${state}`)
    expect(callbackRes.ok).toBe(true)
    const callbackData = await callbackRes.json() as {
      sessionId: string
      claims: { sub: string, iss: string, aud: string, email?: string, name?: string }
    }
    expect(callbackData.sessionId).toBeTruthy()
    expect(callbackData.claims.sub).toBe('alice@example.com')
    expect(callbackData.claims.iss).toBe(`http://127.0.0.1:${idpPort}`)
    expect(callbackData.claims.aud).toBe('sp.example.com')

    // Step 5: SP /me — verify session works
    const meRes = await fetch(`${spBase}/me`, {
      headers: { Authorization: `Bearer ${callbackData.sessionId}` },
    })
    expect(meRes.ok).toBe(true)
    const meData = await meRes.json() as { sub: string }
    expect(meData.sub).toBe('alice@example.com')
  })

  it('returns SP metadata at well-known endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}${WELL_KNOWN_OAUTH_CLIENT_METADATA}`)
    expect(res.ok).toBe(true)
    const data = await res.json() as { client_id: string, client_name: string, redirect_uris: string[] }
    expect(data.client_id).toBe('sp.example.com')
    expect(data.client_name).toBe('Test SP')
    expect(data.redirect_uris).toContain(`http://127.0.0.1:${spPort}/callback`)
  })

  it('rejects login without email parameter', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/login`)
    expect(res.status).toBe(400)
  })

  it('returns 404 when IdP cannot be discovered', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/login?email=nobody@unknown-domain.test`)
    expect(res.status).toBe(404)
  })

  it('rejects callback with missing code or state', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/callback`)
    expect(res.status).toBe(400)
  })

  it('rejects callback with invalid state', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/callback?code=fake&state=bogus`)
    expect(res.status).toBe(400)
  })

  it('rejects /me without auth header', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/me`)
    expect(res.status).toBe(401)
  })

  it('rejects /me with invalid session', async () => {
    const res = await fetch(`http://127.0.0.1:${spPort}/me`, {
      headers: { Authorization: 'Bearer invalid-session-id' },
    })
    expect(res.status).toBe(401)
  })
})
