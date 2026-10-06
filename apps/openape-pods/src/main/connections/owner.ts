import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import type { CredentialCache } from './cache'
import { connectionRequest, readJSON } from './http'

const clientId = 'apes-cli'
const redirectURI = 'http://localhost:9876/callback'
interface OwnerTokens { accessToken: string, refreshToken: string, issuer: string, account: string, subject: string, expiresAt: number }
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
export class OwnerConnection {
  constructor(private readonly credentials: CredentialCache) {}
  private async exchange(issuer: string, account: string, body: unknown, signal: AbortSignal, nonce?: string): Promise<OwnerTokens> {
    const reply = await connectionRequest(issuer, '/token', body, signal)
    if (typeof reply.access_token !== 'string' || typeof reply.refresh_token !== 'string' || !reply.refresh_token) throw new Error('Owner sign-in did not provide a renewable connection')
    const jwks = await readJSON(await fetch(`${issuer}/.well-known/jwks.json`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) }))
    const claims = ownerClaims(reply.access_token, jwks, issuer, account, nonce)
    return { issuer, account, subject: claims.sub, expiresAt: claims.exp, accessToken: reply.access_token, refreshToken: reply.refresh_token }
  }

  async login(id: string, issuer: string, account: string, signal: AbortSignal, present: (value: { url: string }) => void): Promise<{ issuer: string, subject: string }> {
    const origin = new URL(issuer)
    if (origin.protocol !== 'https:' || origin.origin !== issuer) throw new Error('Owner issuer must be an HTTPS origin')
    const state = randomBytes(32).toString('base64url'); const nonce = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url')
    let accept: (code: string) => void = () => {}; let reject: (error: Error) => void = () => {}
    const code = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail })
    const server = createServer((request, response) => {
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
      const value = await this.exchange(issuer, account, { grant_type: 'authorization_code', code: await code, client_id: clientId, redirect_uri: redirectURI, code_verifier: verifier }, signal, nonce)
      await this.credentials.connect(id, JSON.stringify(value))
      return { issuer, subject: value.subject }
    }
    finally { signal.removeEventListener('abort', cancel); server.closeAllConnections(); await new Promise<void>((resolve, fail) => server.close(error => error ? fail(error) : resolve())) }
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
