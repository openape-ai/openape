import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright'
import { PodDatabase } from '../../src/worker/storage/database'

export async function fixtureShellIdentity(root: string) {
  const fixtureKey = randomBytes(32).toString('hex')
  let origin = ''
  const records: { path: string, value: string }[] = []
  const subjects = new Map<string, string>()
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') {
      response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` }))
    }
    else if (request.url?.startsWith('/api/grants?')) {
      const requester = new URL(request.url, origin).searchParams.get('requester')
      const podId = subjects.get(requester ?? '')
      response.end(JSON.stringify({ data: podId ? [{ id: `fixture-${podId}`, status: 'approved', request: { audience: 'ape-shell', target_host: `pods:${podId}`, grant_type: 'timed' } }] : [] }))
    }
    else { response.statusCode = 404; response.end('{}') }
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
    store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(randomUUID(), 'openape', 'fixture-owner@example.test', 'ready', null, JSON.stringify({ issuer: origin, pods }))
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
