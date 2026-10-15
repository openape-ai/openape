import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach } from 'vitest'
import { computeArgvHash } from '@openape/grants'
import type { PreparedMachine } from '../../src/worker/runtime/execution-identity'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

/** Signed local IdP for native tests whose concern is the script protocol, not grant policy. */
export async function machineRuntime() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-native-identity-')))
  const keys = generateKeyPairSync('ed25519'); let origin = ''
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/.well-known/openid-configuration') { response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants` })); return }
      if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'EdDSA', use: 'sig' }] })); return }
      if (request.url === '/api/grants/authorize') {
        let raw = ''; for await (const bytes of request) raw += bytes
        const call = JSON.parse(raw); const now = Math.floor(Date.now() / 1000)
        const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'fixture' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({ iss: origin, sub: 'native-pod@example.invalid', aud: 'shapes', target_host: call.target_host, grant_id: 'native-grant', grant_type: 'always', exp: now + 120, iat: now, jti: randomUUID(), argv_hash: await computeArgvHash([call.program.name, ...call.argv]), program_sha256: call.program.sha256, execution_context: { files: call.files }, authorization_details: [{ type: 'openape_cli', cli_id: call.program.name, action: 'read' }] })).toString('base64url')
        response.end(JSON.stringify({ state: 'approved', grant_id: 'native-grant', authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}`, expires_at: now + 120 })); return
      }
      if (request.url === '/api/grants/native-grant') { response.end('{"status":"approved"}'); return }
      if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'native-pod@example.invalid', owner: 'native-owner@example.invalid', active: true, grantActive: true, keyIds: ['native-key'], grantId: 'native-grant' })); return }
      response.writeHead(404).end('{}')
    })().catch(error => response.destroy(error))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const auth = join(root, 'auth.json')
  await writeFile(auth, JSON.stringify({ idp: origin, email: 'native-pod@example.invalid', owner_email: 'native-owner@example.invalid', agent_key_id: 'native-key', access_token: 'SYNTHETIC_NATIVE_ONLY', expires_at: Math.floor(Date.now() / 1000) + 3600 }), { mode: 0o600 })
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }) })
  const machine: PreparedMachine & { issuer: string } = { runtime: { executable: process.execPath, cli: resolve('dist/vendor/apes/ape-shell.mjs'), environment: { APES_AUTH_FILE: auth } }, targetHost: 'native-fixture', issuer: origin, waitMs: 0 }
  return { machine, prepareExecution: async () => ({ machine, close: async () => {} }) }
}
