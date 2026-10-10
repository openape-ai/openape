import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import type { CredentialCache } from './cache'
import { connectionRequest, readJSON } from './http'
import { OwnerSession, SignInEnded } from './owner-session'
import type { ApesLogin } from './apes-login'

const clientId = 'apes-cli'
const redirectURI = 'http://localhost:9876/callback'
interface OwnerTokens { accessToken: string, refreshToken: string, issuer: string, account: string, subject: string, expiresAt: number }
/** A phone confirmation at the IdP: the link the owner opens and the owner session it yields once approved. */
export interface PhoneSignIn { link: string, expiresAt: number, session: Promise<OwnerSession> }
const channelToken = /^[a-f0-9]{64}$/
const claimInterval = 3000
function equal(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
export function ownerClaims(token: string, jwks: Record<string, unknown>, issuer: string, account: string, nonce?: string): { sub: string, exp: number } {
  if (token.length > 32768) throw new Error('Oversized owner identity')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid owner identity')
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string, kid?: string }
  if (header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !Array.isArray(jwks.keys) || jwks.keys.length > 100) throw new Error('Unsupported owner signing key')
  const keys = jwks.keys.filter(key => key && key.kid === header.kid && key.kty === 'OKP' && key.crv === 'Ed25519')
  if (keys.length !== 1 || !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: keys[0], format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Owner identity signature rejected')
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>
  const now = Date.now() / 1000
  if (claims.iss !== issuer || claims.aud !== clientId || claims.act !== 'human' || claims.email !== account || typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || claims.exp <= now || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) || (nonce !== undefined && claims.nonce !== nonce)) throw new Error('Owner identity does not match the requested account')
  return { sub: claims.sub, exp: claims.exp }
}
function httpsOrigin(issuer: string): void {
  const origin = new URL(issuer)
  if (origin.protocol !== 'https:' || origin.origin !== issuer) throw new Error('Owner issuer must be an HTTPS origin')
}
export class OwnerConnection {
  constructor(private readonly credentials: CredentialCache) {}
  private async exchange(issuer: string, account: string, body: unknown, signal: AbortSignal, nonce?: string): Promise<OwnerTokens> {
    const reply = await connectionRequest(issuer, '/token', body, signal)
    if (typeof reply.access_token !== 'string' || typeof reply.refresh_token !== 'string' || !reply.refresh_token) throw new Error('Owner sign-in did not provide a renewable connection')
    const claims = await this.verify(issuer, account, reply.access_token, signal, nonce)
    return { issuer, account, subject: claims.sub, expiresAt: claims.exp, accessToken: reply.access_token, refreshToken: reply.refresh_token }
  }

  private async verify(issuer: string, account: string, token: string, signal: AbortSignal, nonce?: string): Promise<{ sub: string, exp: number }> {
    const jwks = await readJSON(await fetch(`${issuer}/.well-known/jwks.json`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) }))
    return ownerClaims(token, jwks, issuer, account, nonce)
  }

  /** The session of one sign-in that Pods itself made: renewed with its own refresh token and revoked at the IdP when it ends. */
  private ownSession(issuer: string, account: string, tokens: OwnerTokens, endsAt: number): OwnerSession {
    return new OwnerSession(tokens, endsAt, {
      refresh: async (current, renewal) => {
        const refreshed = await this.exchange(issuer, account, { grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: clientId }, renewal)
        if (refreshed.subject !== current.subject) throw new Error('Refreshed owner identity changed; sign in again')
        return refreshed
      },
      revoke: async (current) => { await connectionRequest(issuer, '/revoke', { token: current.refreshToken }, AbortSignal.timeout(10000)) },
    })
  }

  /**
   * Opens a session from the owner's logged-in apes CLI (owner decision October 10, 2026): its access token is
   * checked like a browser sign-in (signature, issuer, apes-cli audience, human, registered account) and used as the
   * session's owner token. Renewal reads the apes login again, so `apes logout` ends the session; the apes tokens
   * belong to apes and are never revoked or written by Pods. Null when apes has no usable login.
   */
  async apesSession(issuer: string, account: string, endsAt: number, signal: AbortSignal, login: ApesLogin): Promise<OwnerSession | null> {
    const derive = async (renewal: AbortSignal): Promise<OwnerTokens | null> => {
      const proof = await login.token(renewal)
      if (!proof) return null
      if (proof.issuer !== issuer) throw new Error('The apes login belongs to another identity provider than the registered owner')
      const claims = await this.verify(issuer, account, proof.accessToken, renewal)
      return { issuer, account, subject: claims.sub, expiresAt: claims.exp, accessToken: proof.accessToken, refreshToken: '' }
    }
    const tokens = await derive(signal)
    if (!tokens) return null
    return new OwnerSession(tokens, endsAt, {
      refresh: async (_current, renewal) => {
        const renewed = await derive(renewal)
        if (!renewed) throw new Error('The apes login ended; ask the owner to sign in again')
        return renewed
      },
      revoke: async () => {},
      alive: () => login.signedIn(issuer, account),
    })
  }

  /**
   * Asks the owner to confirm this sign-in on the phone through the IdP's QR channel: the link goes to the owner,
   * the claim secret stays here. After approval the transferred IdP browser session runs the same PKCE authorization
   * as the browser sign-in and is ended right after; the session then holds only the tokens Pods minted.
   */
  async phoneSession(issuer: string, account: string, endsAt: number, signal: AbortSignal, requester: string): Promise<PhoneSignIn> {
    httpsOrigin(issuer)
    const reply = await readJSON(await fetch(`${issuer}/api/session/qr`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json', 'User-Agent': requester }, body: '{}' }))
    const { channelId, claimSecret, expiresIn } = reply
    if (typeof channelId !== 'string' || !channelToken.test(channelId) || typeof claimSecret !== 'string' || !channelToken.test(claimSecret) || typeof expiresIn !== 'number' || !(expiresIn > 0)) throw new Error('Invalid phone sign-in channel')
    const expiresAt = Date.now() + Math.min(expiresIn, 3600) * 1000
    const session = (async () => {
      const cookie = await this.claim(issuer, channelId, claimSecret, expiresAt, signal)
      try { return this.ownSession(issuer, account, await this.cookieAuthorization(issuer, account, cookie, signal), endsAt) }
      finally {
        // The IdP session copy is only the vehicle for this authorization; ending it leaves Pods only its own tokens.
        await fetch(`${issuer}/api/session/qr/sessions/${channelId}`, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Cookie: cookie } })
          .then((response) => { if (!response.ok) throw new Error('The identity provider did not end the transferred session') })
          .catch((error: unknown) => console.error('Could not end the transferred IdP session of the phone sign-in:', error instanceof Error ? error.message : 'unknown error'))
      }
    })()
    return { link: `${issuer}/link?c=${channelId}`, expiresAt, session }
  }

  /** Polls the channel until the owner approved it; deny removes the channel, so a vanished channel before its end means denied. */
  private async claim(issuer: string, channelId: string, claimSecret: string, expiresAt: number, signal: AbortSignal): Promise<string> {
    for (;;) {
      signal.throwIfAborted()
      const response = await fetch(`${issuer}/api/session/qr/${channelId}/claim`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claimSecret }) })
      if (response.status === 401 || response.status === 404) {
        await response.body?.cancel()
        if (Date.now() >= expiresAt) throw new SignInEnded('expired', 'The phone confirmation link expired before the owner approved it')
        throw new SignInEnded('denied', 'The owner denied the phone confirmation')
      }
      const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]!.trim()).filter(Boolean)
      const body = await readJSON(response)
      if (body.status === 'ok') {
        if (!cookies.length) throw new Error('The identity provider confirmed the phone sign-in without a session')
        return cookies.join('; ')
      }
      if (body.status !== 'pending') throw new Error('Invalid phone sign-in claim')
      if (Date.now() + claimInterval >= expiresAt) throw new SignInEnded('expired', 'The phone confirmation link expired before the owner approved it')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, claimInterval)
        function stop() { clearTimeout(timer); reject(signal.reason) }
        signal.addEventListener('abort', stop, { once: true })
      })
    }
  }

  /** The browser sign-in's PKCE authorization, answered by the transferred IdP session instead of a browser. */
  private async cookieAuthorization(issuer: string, account: string, cookie: string, signal: AbortSignal): Promise<OwnerTokens> {
    const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url')
    const url = new URL('/authorize', issuer)
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectURI, response_type: 'code', scope: 'openid email profile offline_access', state, nonce, login_hint: account, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Cookie: cookie } })
    await response.body?.cancel()
    const location = response.status >= 300 && response.status < 400 ? URL.parse(response.headers.get('location') ?? '', issuer) : null
    const code = location?.searchParams.get('code')
    if (!location || `${location.origin}${location.pathname}` !== redirectURI || location.searchParams.has('error') || !code || code.length > 4096 || !equal(location.searchParams.get('state') ?? '', state)) throw new Error('The identity provider did not authorize the phone sign-in for this client')
    return this.exchange(issuer, account, { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectURI, code_verifier: verifier }, signal, nonce)
  }

  async login(id: string, issuer: string, account: string, signal: AbortSignal, present: (value: { url: string }) => void): Promise<{ issuer: string, subject: string }> {
    const value = await this.authorize(issuer, account, signal, present)
    await this.credentials.connect(id, JSON.stringify(value))
    return { issuer, subject: value.subject }
  }

  /**
   * Signs the owner in now for one MCP session without touching the stored connection. The tokens stay in the
   * returned session in memory and end with it at `endsAt` at the latest.
   */
  async session(issuer: string, account: string, endsAt: number, signal: AbortSignal, present: (value: { url: string }) => void): Promise<OwnerSession> {
    return this.ownSession(issuer, account, await this.authorize(issuer, account, signal, present), endsAt)
  }

  private async authorize(issuer: string, account: string, signal: AbortSignal, present: (value: { url: string }) => void): Promise<OwnerTokens> {
    httpsOrigin(issuer)
    const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url')
    let accept: (code: string) => void = () => {}; let reject: (error: Error) => void = () => {}
    const code = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail })
    const server = createServer((request, response) => {
      // The listener is gone after this sign-in, so a client must not keep the connection for its next request.
      response.setHeader('Connection', 'close')
      const url = new URL(request.url ?? '/', redirectURI)
      if (request.method !== 'GET' || request.headers.host !== 'localhost:9876' || url.pathname !== '/callback' || url.searchParams.getAll('state').length !== 1 || !equal(url.searchParams.get('state') ?? '', state)) { response.writeHead(400); response.end('Sign-in callback rejected.'); return }
      const value = url.searchParams.get('code')
      if (url.searchParams.has('error') || !value || value.length > 4096 || url.searchParams.getAll('code').length !== 1) { response.writeHead(400); response.end('Sign-in was not completed.'); reject(new Error('Owner sign-in was declined')); return }
      response.setHeader('Content-Type', 'text/plain'); response.end('OpenApe Pods sign-in received. Return to the app.'); accept(value)
    })
    await new Promise<void>((resolve, fail) => { server.once('error', fail); server.listen(9876, '127.0.0.1', resolve) })
    const cancel = () => reject(new Error('Owner sign-in cancelled'))
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    try {
      const url = new URL('/authorize', issuer)
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectURI, response_type: 'code', scope: 'openid email profile offline_access', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
      present({ url: url.toString() })
      return await this.exchange(issuer, account, { grant_type: 'authorization_code', code: await code, client_id: clientId, redirect_uri: redirectURI, code_verifier: verifier }, signal, nonce)
    }
    finally { signal.removeEventListener('abort', cancel); server.closeIdleConnections(); await new Promise<void>((resolve, fail) => server.close(error => error ? fail(error) : resolve())) }
  }

  async bearer(id: string, issuer: string, account: string, signal: AbortSignal): Promise<string> {
    return this.credentials.withCache(id, async (file) => {
      let value = JSON.parse(await readFile(file, 'utf8')) as OwnerTokens
      if (value.issuer !== issuer || value.account !== account || typeof value.subject !== 'string' || typeof value.refreshToken !== 'string' || typeof value.accessToken !== 'string' || !Number.isFinite(value.expiresAt)) throw new Error('Owner connection binding is invalid')
      if (value.expiresAt <= Date.now() / 1000 + 60) {
        const refreshed = await this.exchange(issuer, account, { grant_type: 'refresh_token', refresh_token: value.refreshToken, client_id: clientId }, signal)
        if (refreshed.subject !== value.subject) throw new Error('Refreshed owner identity changed; reconnect')
        value = refreshed; await writeFile(file, JSON.stringify(value), { mode: 0o600 })
      }
      return value.accessToken
    }, signal)
  }
}
