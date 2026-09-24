import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import type { HttpAuthentication } from '../../contracts/http'

type Transport = (url: string, options: RequestInit) => Promise<Response>
const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const cacheKey = (authentication: HttpAuthentication) => JSON.stringify([authentication.credential, authentication.subject, authentication.issuer])

// Agent tokens stay in main-process memory. Scripts, logs, run events and effect
// receipts never receive them; the runtime only adds the outgoing header.
export class DdisaAgentTokens {
  private readonly cache = new Map<string, { podId: string, credentialId: string, token: string, expiresAt: number }>()

  constructor(private readonly transport: Transport = fetch, private readonly now = () => Date.now()) {}

  async bearer(podId: string, authentication: HttpAuthentication, credentialId: string, readKey: () => Promise<string>, signal: AbortSignal): Promise<string> {
    const key = `${podId}:${cacheKey(authentication)}`
    const cached = this.cache.get(key)
    if (cached && cached.credentialId === credentialId && cached.expiresAt - 60_000 > this.now()) return cached.token
    const issuedAt = Math.floor(this.now() / 1000)
    const unsigned = `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({ iss: authentication.subject, sub: authentication.subject, aud: `${authentication.issuer}/token`, jti: randomUUID(), iat: issuedAt, exp: issuedAt + 300 })}`
    const assertion = `${unsigned}.${sign(null, Buffer.from(unsigned), createPrivateKey(await readKey())).toString('base64url')}`
    const response = await this.transport(`${authentication.issuer}/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion }),
    })
    if (!response.ok) throw new Error(`DDISA agent authentication failed (${response.status})`)
    const reply = await response.json() as { access_token?: unknown, expires_in?: unknown }
    if (typeof reply.access_token !== 'string' || !reply.access_token || typeof reply.expires_in !== 'number' || reply.expires_in <= 60 || reply.expires_in > 86400) throw new Error('DDISA agent authentication returned an invalid token')
    this.cache.set(key, { podId, credentialId, token: reply.access_token, expiresAt: this.now() + reply.expires_in * 1000 })
    return reply.access_token
  }

  reject(podId: string, authentication: HttpAuthentication): void { this.cache.delete(`${podId}:${cacheKey(authentication)}`) }
}
