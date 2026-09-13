import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type { CredentialCache } from './cache'
import type { AgentConnection } from '../broker/authorization'

interface IdentityCache {
  podId: string
  issuer: string
  owner: string
  privateKey: string
  publicKey: string
  keyId: string
  subject?: string
  accessToken?: string
  expiresAt?: number
}
export interface PodIdentityReference { connectionId: string, podId: string, issuer: string, owner: string, subject: string, keyId: string }
function origin(value: string): string {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Invalid identity origin')
  return url.origin
}
async function post(issuer: string, path: string, body: unknown, bearer?: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${origin(issuer)}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Pod identity connection failed (${response.status})`)
  const text = await response.text()
  if (text.length > 128 * 1024) throw new Error('Oversized identity response')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid identity response')
  return value as Record<string, unknown>
}
export class PodIdentityManager {
  constructor(private readonly credentials: CredentialCache) {}

  async prepare(connectionId: string, podId: string, issuer: string, owner: string): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(podId) || !owner.includes('@')) throw new Error('Invalid pod owner binding')
    const keys = generateKeyPairSync('ed25519')
    const raw = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x!, 'base64url')
    const header = Buffer.from('0000000b7373682d6564323535313900000020', 'hex')
    const wire = Buffer.concat([header, raw])
    const identity: IdentityCache = { podId, issuer: origin(issuer), owner, privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: `ssh-ed25519 ${wire.toString('base64')}`, keyId: createHash('sha256').update(wire).digest('hex') }
    await this.credentials.create(connectionId, JSON.stringify(identity))
  }

  async provision(connectionId: string, name: string, ownerBearer: string): Promise<PodIdentityReference> {
    return this.credentials.withCache(connectionId, async (file) => {
      const identity = JSON.parse(await readFile(file, 'utf8')) as IdentityCache
      const reply = await post(identity.issuer, '/api/pods/agents', { podId: identity.podId, name, publicKey: identity.publicKey }, ownerBearer)
      if (reply.owner !== identity.owner || reply.keyId !== identity.keyId || reply.permissions !== 'none' || typeof reply.email !== 'string' || (identity.subject && reply.email !== identity.subject)) throw new Error('Provisioned identity does not match this pod')
      identity.subject = reply.email
      await writeFile(file, JSON.stringify(identity), { mode: 0o600 })
      return { connectionId, podId: identity.podId, issuer: identity.issuer, owner: identity.owner, subject: identity.subject, keyId: identity.keyId }
    })
  }

  connection(reference: PodIdentityReference, targetHost: string): AgentConnection {
    return { issuer: reference.issuer, subject: reference.subject, owner: reference.owner, keyId: reference.keyId, targetHost, accessToken: async () => this.credentials.withCache(reference.connectionId, async (file) => {
      const identity = JSON.parse(await readFile(file, 'utf8')) as IdentityCache
      if (identity.podId !== reference.podId || identity.issuer !== reference.issuer || identity.owner !== reference.owner || identity.subject !== reference.subject || identity.keyId !== reference.keyId) throw new Error('Pod identity cache binding mismatch')
      if (identity.accessToken && (identity.expiresAt ?? 0) > Date.now() / 1000 + 60) return identity.accessToken
      const challenge = await post(identity.issuer, '/api/auth/challenge', { id: identity.subject })
      if (typeof challenge.challenge !== 'string' || challenge.challenge.length > 4096) throw new Error('Invalid pod identity challenge')
      const signature = sign(null, Buffer.from(challenge.challenge), identity.privateKey).toString('base64')
      const reply = await post(identity.issuer, '/api/auth/authenticate', { id: identity.subject, challenge: challenge.challenge, signature, public_key: identity.publicKey })
      if (reply.act !== 'agent' || reply.email !== identity.subject || typeof reply.token !== 'string' || typeof reply.expires_in !== 'number' || reply.expires_in <= 60 || reply.expires_in > 28800) throw new Error('Pod authentication returned a different identity or invalid lifetime')
      identity.accessToken = reply.token; identity.expiresAt = Math.floor(Date.now() / 1000) + reply.expires_in
      await writeFile(file, JSON.stringify(identity), { mode: 0o600 })
      return identity.accessToken
    }) }
  }
}
