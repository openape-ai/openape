import { transientNetwork, transientResponse } from '../../contracts/infrastructure'
import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import { AuthError, requestSpToken } from '@openape/cli-auth'
import type { HttpAuthentication } from '../../contracts/http'
import { publicHttps } from './http'

type Transport = (url: string, options: RequestInit) => Promise<Response>
interface CachedToken { podId: string, credentialId: string, token: string, expiresAt: number }
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const cacheKey = (podId: string, authentication: HttpAuthentication) => `${podId}:${JSON.stringify([authentication.credential, authentication.subject, authentication.issuer])}`

// Agent and exchanged service tokens stay in main-process memory. Scripts, logs, run
// events and effect receipts never receive them; the runtime only adds the outgoing header.
export class DdisaAgentTokens {
  private readonly cache = new Map<string, CachedToken>()

  constructor(private readonly transport: Transport = publicHttps, private readonly now = () => Date.now()) {}

  private fresh(key: string, credentialId: string): CachedToken | undefined {
    const cached = this.cache.get(key)
    return cached && cached.credentialId === credentialId && cached.expiresAt - 60_000 > this.now() ? cached : undefined
  }

  // Authentication endpoints count as permission infrastructure: unavailable services are retried, never followed through redirects.
  private async send(url: string, options: RequestInit, signal: AbortSignal): Promise<Response> {
    let response: Response
    try { response = await this.transport(url, { ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) }) }
    catch (error) { transientNetwork(error, 'authorization', signal) }
    try { transientResponse(response, 'authorization') }
    catch (error) { await response.body?.cancel(); throw error }
    return response
  }

  private async agent(podId: string, authentication: HttpAuthentication, credentialId: string, readKey: () => Promise<string>, signal: AbortSignal): Promise<CachedToken> {
    const key = cacheKey(podId, authentication)
    const cached = this.fresh(key, credentialId)
    if (cached) return cached
    const issuedAt = Math.floor(this.now() / 1000)
    const unsigned = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({ iss: authentication.subject, sub: authentication.subject, aud: `${authentication.issuer}/token`, jti: randomUUID(), iat: issuedAt, exp: issuedAt + 300 })}`
    const assertion = `${unsigned}.${sign(null, Buffer.from(unsigned), createPrivateKey(await readKey())).toString('base64url')}`
    const response = await this.send(`${authentication.issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion }),
    }, signal)
    if (!response.ok) throw new Error(`DDISA agent authentication failed (${response.status})`)
    let reply: { access_token?: unknown, expires_in?: unknown }
    try { reply = await response.json() as typeof reply }
    catch { throw new Error('DDISA agent authentication returned an invalid token') }
    if (typeof reply.access_token !== 'string' || !reply.access_token || typeof reply.expires_in !== 'number' || reply.expires_in <= 60 || reply.expires_in > 86400) throw new Error('DDISA agent authentication returned an invalid token')
    const token = { podId, credentialId, token: reply.access_token, expiresAt: this.now() + reply.expires_in * 1000 }
    this.cache.set(key, token)
    return token
  }

  /** The agent's own IdP token. */
  async bearer(podId: string, authentication: HttpAuthentication, credentialId: string, readKey: () => Promise<string>, signal: AbortSignal): Promise<string> {
    return (await this.agent(podId, authentication, credentialId, readKey, signal)).token
  }

  /**
   * The bearer for one assigned destination origin. With exchange 'sp' the agent token is
   * traded at that origin's /api/cli/exchange (RFC 8693) for the service's own token; the
   * exchange goes only to the already authorized origin and needs no further grant.
   */
  async destination(podId: string, authentication: HttpAuthentication, origin: string, credentialId: string, readKey: () => Promise<string>, signal: AbortSignal): Promise<string> {
    if (authentication.exchange !== 'sp') return this.bearer(podId, authentication, credentialId, readKey, signal)
    const key = `${cacheKey(podId, authentication)}:${origin}`
    const cached = this.fresh(key, credentialId)
    if (cached) return cached.token
    const agent = await this.agent(podId, authentication, credentialId, readKey, signal)
    let exchanged: Awaited<ReturnType<typeof requestSpToken>>
    try {
      exchanged = await requestSpToken(agent.token, { endpoint: origin, aud: new URL(origin).host }, { transport: (url, options) => this.send(url, options, signal) }, Math.floor(this.now() / 1000))
    }
    catch (error) {
      if (!(error instanceof AuthError)) throw error
      if (error.status === 401) this.reject(podId, authentication)
      throw new Error(`Service sign-in at ${origin} failed (${error.status || 'invalid reply'})`)
    }
    // Never outlive the agent token: a revoked agent loses access at its next IdP refresh.
    const token = { podId, credentialId, token: exchanged.access_token, expiresAt: Math.min(exchanged.expires_at * 1000, agent.expiresAt) }
    this.cache.set(key, token)
    return token.token
  }

  /** Forgets the agent token and every service token exchanged for it. */
  reject(podId: string, authentication: HttpAuthentication): void {
    const key = cacheKey(podId, authentication)
    for (const entry of [...this.cache.keys()]) {
      if (entry === key || entry.startsWith(`${key}:`)) this.cache.delete(entry)
    }
  }
}
