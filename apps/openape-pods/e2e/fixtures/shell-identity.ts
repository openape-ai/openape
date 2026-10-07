import { computeCmdHash } from '@openape/core'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { PodDatabase } from '../../src/worker/storage/database'

export async function fixtureShellIdentity(root: string, ownerPermissions: string[] = [], networkGates = false, provisioning = false) {
  const fixtureKey = randomBytes(32).toString('hex')
  let origin = ''
  const records: { path: string, value: string }[] = []
  const subjects = new Map<string, string>()
  const enrollmentKeys = new Map<string, string>()
  const enrollmentAttempts: { podId: string, keyId: string }[] = []
  let failEnrollment = false
  const brokerId = randomUUID()
  const keys = generateKeyPairSync('ed25519')
  const heldConsumes = new Map<string, { wait: Promise<void>, release: () => void }>()
  const consumes = new Map<string, number>()
  const grants = new Map<string, { requester: string, target_host: string, audience: string, grant_type: string, authorization_details: unknown[], execution_context: unknown, command?: string[], status?: 'pending' | 'approved' | 'denied' | 'used' }>()
  const server = createServer((request, response) => {
    const respond = async () => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/.well-known/openid-configuration') {
        response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants`, ...(provisioning ? { issuer: origin, openape_grant_brokering_version: '1.0', openape_broker_connections_endpoint: `${origin}/api/fixture-connections`, openape_broker_enrollment_endpoint: `${origin}/api/fixture-enrollment` } : {}) }))
      }
      else if (provisioning && request.url === `/api/fixture-connections/${brokerId}/receipt`) {
        if (request.headers.authorization !== 'Bearer SYNTHETIC_OWNER_TOKEN') { response.writeHead(403).end('{}'); return }
        response.end(JSON.stringify({ connection_receipt: 'SYNTHETIC_LOCAL_CONSENT' }))
      }
      else if (provisioning && request.url === '/api/fixture-enrollment') {
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString())
        if (body.connection_receipt !== 'SYNTHETIC_LOCAL_CONSENT' || typeof body.podId !== 'string' || typeof body.publicKey !== 'string') { response.writeHead(403).end('{}'); return }
        const keyId = createHash('sha256').update(Buffer.from(body.publicKey.split(' ')[1], 'base64')).digest('hex')
        const subject = `enrolled-${body.podId}@example.test`
        if (enrollmentKeys.has(subject) && enrollmentKeys.get(subject) !== keyId) { response.writeHead(409).end('{}'); return }
        subjects.set(subject, body.podId); enrollmentKeys.set(subject, keyId); enrollmentAttempts.push({ podId: body.podId, keyId })
        if (failEnrollment) { failEnrollment = false; response.writeHead(503).end('{}'); return }
        response.end(JSON.stringify({ owner: 'fixture-owner@example.test', email: subject, keyId, permissions: 'none', decisionIssuer: origin, brokerConnectionId: brokerId }))
      }
      else if (request.url?.startsWith('/api/grants?')) {
        const query = new URL(request.url, origin).searchParams
        const requester = query.get('requester')
        const batch = query.get('batch')
        if (batch) {
          response.end(JSON.stringify({ data: [...grants.entries()].filter(([, grant]) => grant.requester === requester && (grant as { batch?: { id: string } }).batch?.id === batch).map(([id, grant]) => ({ id, status: grant.status ?? 'approved', request: grant, ...(grant.command?.[0] === 'pods-graph-gate' ? { decided_by: 'fixture-owner@example.test' } : {}) })) }))
          return
        }
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
        const gate = networkGates && body.command?.[0] === 'pods-graph-gate' && body.audience === 'pods-graph-gate' && body.grant_type === 'once'
        if (!subjects.has(body.requester) || (body.command?.[0] !== 'pod-runtime' && !reviewed && !gate)) { response.writeHead(403).end('{}'); return }
        const id = randomUUID(); grants.set(id, { ...body, ...(gate ? { status: 'pending' } : {}) })
        response.end(JSON.stringify({ id, status: gate ? 'pending' : 'approved' }))
      }
      else if (request.url?.startsWith('/api/pods/agents/')) {
        const url = new URL(request.url, origin); const id = url.searchParams.get('grant') ?? ''
        const subject = decodeURIComponent(url.pathname.split('/').at(-1)!)
        response.end(JSON.stringify({ email: subject, owner: 'fixture-owner@example.test', active: subjects.has(subject), keyIds: [enrollmentKeys.get(subject) ?? 'fixture-key'], grantId: id, grantActive: grants.get(id)?.requester === subject && grants.get(id)?.status !== 'denied' }))
      }
      else if (request.url?.startsWith('/api/grants/')) {
        const [, , , id, action] = request.url.split('/')
        const grant = grants.get(id!)
        if (!grant) { response.writeHead(404).end('{}'); return }
        const gate = grant.command?.[0] === 'pods-graph-gate'
        if (action === 'token') {
          if (gate && grant.status !== 'approved') { response.writeHead(403).end('{}'); return }
          const now = Math.floor(Date.now() / 1000)
          const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
          const body = Buffer.from(JSON.stringify({ iss: origin, sub: grant.requester, aud: grant.audience, target_host: grant.target_host, grant_id: id, grant_type: grant.grant_type, iat: now, exp: now + 60, jti: randomUUID(), authorization_details: grant.authorization_details, execution_context: grant.execution_context, ...(gate ? { command: grant.command, cmd_hash: await computeCmdHash(grant.command!.join(' ')), decided_by: 'fixture-owner@example.test' } : {}) })).toString('base64url')
          response.end(JSON.stringify({ authz_jwt: `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), keys.privateKey).toString('base64url')}` }))
        }
        else if (action === 'consume') {
          if (gate) consumes.set(id!, (consumes.get(id!) ?? 0) + 1)
          if (gate && grant.status !== 'approved') { response.writeHead(409).end(JSON.stringify({ error: 'Once-grant cannot be consumed again' })); return }
          if (gate) grant.status = 'used'
          await heldConsumes.get(id!)?.wait
          response.end(JSON.stringify({ status: gate ? 'consumed' : 'valid' }))
        }
        else { response.end(JSON.stringify({ id, status: grant.status ?? 'approved', request: grant, ...(gate ? { decided_by: 'fixture-owner@example.test' } : {}) })) }
      }
      else { response.statusCode = 404; response.end('{}') }
    }
    void respond().catch((error: unknown) => response.destroy(error instanceof Error ? error : new Error('Fixture grant request failed')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ownerId = randomUUID()
  const pods: Record<string, unknown> = {}
  function registerPods(store: PodDatabase) {
    for (const pod of store.listPods()) {
      if (Object.hasOwn(pods, pod.id)) continue
      const id = randomUUID(); const subject = `fixture-${pod.id}@example.test`; const owner = 'fixture-owner@example.test'
      const identity = { connectionId: id, podId: pod.id, issuer: origin, owner, subject, keyId: 'fixture-key' }
      subjects.set(subject, pod.id)
      pods[pod.id] = { connectionId: id, prepared: true, identity }
      records.push({ path: join(root, 'credentials', `${id}.encrypted`), value: JSON.stringify({ ...identity, privateKey: 'SYNTHETIC_NOT_A_REAL_KEY', accessToken: 'LOCAL_SYNTHETIC_TOKEN', expiresAt: Date.now() / 1000 + 3600 }) })
    }
  }
  const store = new PodDatabase(root)
  try {
    registerPods(store)
    if (ownerPermissions.length || provisioning) records.push({ path: join(root, 'credentials', `${ownerId}.encrypted`), value: JSON.stringify({ issuer: origin, account: 'fixture-owner@example.test', subject: 'fixture-owner', accessToken: 'SYNTHETIC_OWNER_TOKEN', refreshToken: 'SYNTHETIC_REFRESH_TOKEN', expiresAt: Date.now() / 1000 + 3600 }) })
    store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(ownerId, 'openape', 'fixture-owner@example.test', 'ready', null, JSON.stringify({ issuer: origin, subject: 'fixture-owner@example.test', pods, ...(provisioning ? { broker: { issuer: origin, domain: 'example.test', connectionId: brokerId } } : {}) }))
  }
  finally { store.close() }
  return {
    failNextEnrollment: () => { if (!provisioning) throw new Error('Provisioning fixture is disabled'); failEnrollment = true },
    enrollmentAttempts: () => structuredClone(enrollmentAttempts),
    owner: { issuer: origin, subject: 'fixture-owner@example.test' },
    attachPods: () => {
      const database = new PodDatabase(root)
      try {
        registerPods(database)
        database.db.prepare('UPDATE connections SET metadata=? WHERE id=?').run(JSON.stringify({ issuer: origin, subject: 'fixture-owner@example.test', pods, ...(provisioning ? { broker: { issuer: origin, domain: 'example.test', connectionId: brokerId } } : {}) }), ownerId)
      }
      finally { database.close() }
    },
    gates: () => [...grants.entries()].filter(([, grant]) => grant.command?.[0] === 'pods-graph-gate').map(([id, grant]) => ({ id, status: grant.status, command: grant.command!, consumeAttempts: consumes.get(id) ?? 0 })),
    holdGateConsume: (id: string) => {
      const grant = grants.get(id)
      if (!networkGates || grant?.command?.[0] !== 'pods-graph-gate' || grant.status !== 'pending' || heldConsumes.has(id)) throw new Error('Only a pending synthetic network grant can hold its consume response')
      let release!: () => void
      const wait = new Promise<void>((resolve) => { release = resolve })
      heldConsumes.set(id, { wait, release })
    },
    releaseGateConsume: (id: string) => {
      const held = heldConsumes.get(id)
      if (!held) throw new Error('Synthetic consume response is not held')
      held.release(); heldConsumes.delete(id)
    },
    decideGate: (id: string, decision: 'approved' | 'denied') => {
      const grant = grants.get(id)
      if (!networkGates || !grant || grant.command?.[0] !== 'pods-graph-gate' || grant.status !== 'pending') throw new Error('Synthetic owner can decide only a pending network gate')
      grant.status = decision
    },
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
    close: async () => { for (const held of heldConsumes.values()) held.release(); heldConsumes.clear(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
