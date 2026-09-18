import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { PodDatabase } from '../../src/worker/storage/database'

export async function fixtureShellIdentity(root: string, ownerPermissions: string[] = []) {
  const fixtureKey = randomBytes(32).toString('hex')
  let origin = ''
  const records: { path: string, value: string }[] = []
  const subjects = new Map<string, string>()
  const keys = generateKeyPairSync('ed25519')
  const grants = new Map<string, { requester: string, target_host: string, audience: string, grant_type: string, authorization_details: unknown[], execution_context: unknown }>()
  const server = createServer((request, response) => {
    const respond = async () => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/.well-known/openid-configuration') {
        response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
      }
      else if (request.url?.startsWith('/api/grants?')) {
        const requester = new URL(request.url, origin).searchParams.get('requester')
        const podId = subjects.get(requester ?? '')
        response.end(JSON.stringify({ data: podId ? [{ id: `fixture-${podId}`, status: 'approved', request: { audience: 'ape-shell', target_host: `pods:${podId}`, grant_type: 'timed' } }] : [] }))
      }
      else if (request.url === '/.well-known/jwks.json') {
        response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] }))
      }
      else if (request.url === '/api/grants' && request.method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const reviewed = Array.isArray(body.authorization_details) && body.authorization_details.length > 0 && body.authorization_details.every((detail: { cli_id: string }) => ownerPermissions.includes(detail.cli_id))
        if (!subjects.has(body.requester) || (body.command?.[0] !== 'pod-runtime' && !reviewed)) { response.writeHead(403).end('{}'); return }
        const id = randomUUID(); grants.set(id, body)
        response.end(JSON.stringify({ id, status: 'approved' }))
      }
      else if (request.url?.startsWith('/api/pods/agents/')) {
        const url = new URL(request.url, origin); const id = url.searchParams.get('grant') ?? ''
        const subject = decodeURIComponent(url.pathname.split('/').at(-1)!)
        response.end(JSON.stringify({ email: subject, owner: 'fixture-owner@example.test', active: subjects.has(subject), keyIds: ['fixture-key'], grantId: id, grantActive: grants.get(id)?.requester === subject }))
      }
      else if (request.url?.startsWith('/api/grants/')) {
        const [, , , id, action] = request.url.split('/')
        const grant = grants.get(id!)
        if (!grant) { response.writeHead(404).end('{}'); return }
        if (action === 'token') {
          const now = Math.floor(Date.now() / 1000)
          const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
          const body = Buffer.from(JSON.stringify({ iss: origin, sub: grant.requester, aud: grant.audience, target_host: grant.target_host, grant_id: id, grant_type: grant.grant_type, iat: now, exp: now + 60, jti: randomUUID(), authorization_details: grant.authorization_details, execution_context: grant.execution_context })).toString('base64url')
          response.end(JSON.stringify({ authz_jwt: `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}` }))
        }
        else if (action === 'consume') { response.end(JSON.stringify({ status: 'valid' })) }
        else { response.end(JSON.stringify({ id, status: 'approved', request: grant })) }
      }
      else { response.statusCode = 404; response.end('{}') }
    }
    void respond().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error('Fixture grant request failed')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const store = new PodDatabase(root)
  try {
    const pods: Record<string, unknown> = {}
    for (const pod of store.listPods()) {
      const id = randomUUID(); const subject = `fixture-${pod.id}@example.test`; const owner = 'fixture-owner@example.test'
      const identity = { connectionId: id, podId: pod.id, issuer: origin, owner, subject, keyId: 'fixture-key' }
      subjects.set(subject, pod.id)
      pods[pod.id] = { connectionId: id, prepared: true, identity }
      records.push({ path: join(root, 'credentials', `${id}.encrypted`), value: JSON.stringify({ ...identity, privateKey: 'SYNTHETIC_NOT_A_REAL_KEY', accessToken: 'LOCAL_SYNTHETIC_TOKEN', expiresAt: Date.now() / 1000 + 3600 }) })
    }
    const ownerId = randomUUID()
    if (ownerPermissions.length) records.push({ path: join(root, 'credentials', `${ownerId}.encrypted`), value: JSON.stringify({ issuer: origin, account: 'fixture-owner@example.test', subject: 'fixture-owner', accessToken: 'SYNTHETIC_OWNER_TOKEN', refreshToken: 'SYNTHETIC_REFRESH_TOKEN', expiresAt: Date.now() / 1000 + 3600 }) })
    store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(ownerId, 'openape', 'fixture-owner@example.test', 'ready', null, JSON.stringify({ issuer: origin, pods }))
  }
  finally { store.close() }
  return {
    encrypt: async (app: ElectronApplication, synthetic = false) => app.evaluate(({ safeStorage }, { records, synthetic, key }) => {
      if (synthetic) {
        const { createCipheriv, createDecipheriv, randomBytes } = process.getBuiltinModule('node:crypto') as typeof import('node:crypto')
        safeStorage.isEncryptionAvailable = () => true
        safeStorage.encryptString = (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]) }
        safeStorage.decryptString = (bytes) => { const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString() }
      }
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      const path = process.getBuiltinModule('node:path') as typeof import('node:path')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Fixture shell credential cipher is unavailable')
      for (const record of records) { fs.mkdirSync(path.dirname(record.path), { recursive: true, mode: 0o700 }); fs.writeFileSync(record.path, safeStorage.encryptString(record.value), { mode: 0o600 }) }
    }, { records, synthetic, key: fixtureKey }),
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
