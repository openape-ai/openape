import { createHash, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const digest = (body: string) => createHash('sha256').update(body).digest('hex')
const audience = 'reports-plans-compatibility/1'
function key(secret: string) {
  if (secret.length < 32) throw new Error('Plans bridge secret must contain at least 32 characters')
  return new TextEncoder().encode(secret)
}
export async function signPlansBridge(secret: string, subject: string | null, actor: string | null, method: string, path: string, body: string) {
  return new SignJWT({ subject, actor, method, path, digest: digest(body) }).setProtectedHeader({ alg: 'HS256' }).setIssuer('plans-compatibility').setAudience(audience).setIssuedAt().setExpirationTime('30s').setJti(randomUUID()).sign(key(secret))
}
const used = new Map<string, number>()
export async function verifyPlansBridge(secret: string, token: string, method: string, path: string, body: string) {
  const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], issuer: 'plans-compatibility', audience, maxTokenAge: '30s', requiredClaims: ['jti', 'exp', 'iat'] })
  if (payload.method !== method || payload.path !== path || payload.digest !== digest(body) || !payload.jti) throw new Error('Bridge request mismatch')
  for (const [id, deadline] of used) {
    if (deadline <= Date.now()) used.delete(id)
  }
  if (used.has(payload.jti) || used.size > 10000) throw new Error('Bridge replay or capacity exceeded')
  used.set(payload.jti, payload.exp! * 1000)
  if (payload.subject === null && payload.actor === null) return null
  if (typeof payload.subject !== 'string' || typeof payload.actor !== 'string') throw new Error('Invalid bridge identity')
  return { subject: payload.subject, actor: payload.actor }
}
