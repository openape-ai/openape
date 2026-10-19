import { mailTLSFixture } from './fixtures/mail-tls'
import { startNetworkProxy } from '../src/main/network/proxy'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { computeArgvHash } from '@openape/grants'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialCache } from '../src/main/connections/cache'
import { PodToolBroker } from '../src/main/broker/tools'
import type { ToolAssignment } from '../src/main/broker/tools'

let root = ''
let server: Server | undefined
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  server = undefined
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})
async function setup(packaged = false, slow = false, unicode = false) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-tool-broker-')))
  const privateRoot = join(root, 'private'); await mkdir(privateRoot)
  const credentialRoot = join(root, 'credentials')
  const cache = new CredentialCache(credentialRoot)
  const connectionId = randomUUID(); const siblingId = randomUUID()
  await cache.connect(connectionId, JSON.stringify({ access_token: 'SYNTHETIC_ASSIGNED_TOKEN' }))
  await cache.connect(siblingId, JSON.stringify({ access_token: 'SYNTHETIC_OTHER_TOKEN' }))
  const toolFile = join(privateRoot, 'fixture.mjs')
  await writeFile(toolFile, `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
const cache=JSON.parse(fs.readFileSync(process.env.POD_TOOL_AUTH_FILE,'utf8'));
const result={assigned:!!cache.access_token, childDenied:!!spawnSync('/bin/echo',['UNASSIGNED']).error};
try { fs.readFileSync(${JSON.stringify(join(credentialRoot, `${siblingId}.encrypted`))}); result.siblingDenied=false } catch { result.siblingDenied=true }
cache.access_token='SYNTHETIC_ROTATED_TOKEN';fs.writeFileSync(process.env.POD_TOOL_AUTH_FILE,JSON.stringify(cache));
console.log(JSON.stringify(result));console.error(cache.access_token);
${unicode ? `for (const byte of Buffer.from('Grüße 日本語')) { process.stdout.write(Buffer.from([byte])); await new Promise(resolve=>setTimeout(resolve,5)); }` : ''}
${slow ? 'setInterval(()=>{},1000);' : ''}`)
  // The IdP authorizes each program call (issue 1473, revision 4); its grant authorizes reads of the synthetic cache.
  const keys = generateKeyPairSync('ed25519'); const state = { active: true, grantActive: true, subject: 'pod@example.test', requests: [] as string[], executions: 0, actions: ['read'] }
  let origin = ''
  server = createServer(async (request, response) => {
    state.requests.push(`${request.method} ${request.url}`); response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })); return }
    if (request.url === '/api/grants/authorize' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk
      const body = JSON.parse(text) as { program: { name: string, sha256: string }, argv: string[], files?: { path: string, sha256: string }[] }
      if (!state.active || !state.grantActive) { response.statusCode = 403; response.end(JSON.stringify({ statusCode: 403, data: { title: 'Agent is not active' } })); return }
      state.executions++
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: origin, sub: state.subject, aud: 'shapes', target_host: 'fixture-mac', grant_id: 'assigned', grant_type: 'always', iat: now, exp: now + 60, jti: randomUUID(), decided_by: 'owner@example.test', ...(body.files ? { execution_context: { files: body.files } } : {}), authorization_details: state.actions.map(action => ({ type: 'openape_cli', cli_id: body.program.name, operation_id: 'fixture', resource_chain: [], action, permission: `${body.program.name}.fixture#${action}`, display: 'Synthetic', risk: 'low' })), argv_hash: await computeArgvHash([body.program.name, ...body.argv]), program_sha256: body.program.sha256 })).toString('base64url')
      const signature = sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')
      response.end(JSON.stringify({ state: 'approved', grant_id: 'assigned', authz_jwt: `${head}.${payload}.${signature}`, expires_at: now + 60 })); return
    }
    if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: state.active, keyIds: ['pod-key'], grantId: 'assigned', grantActive: state.grantActive })); return }
    if (request.url === '/api/grants/assigned') { response.end(JSON.stringify({ id: 'assigned', status: state.grantActive ? 'approved' : 'revoked', request: { requester: 'pod@example.test', target_host: 'fixture-mac', audience: 'shapes', grant_type: 'always' } })); return }
    response.statusCode = 404; response.end('{}')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  origin = `http://127.0.0.1:${address.port}`
  const identityConnection = { issuer: origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_AGENT_BEARER' }
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
  const executable = packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath
  const helper = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist/native/pods-helper') : resolve('dist/native/pods-helper')
  const assignment: ToolAssignment = { identityConnection, id: 'fixture', capability: 'fixture.read', executable, executableHash: sha(await readFile(executable)), entryFiles: [{ path: toolFile, hash: sha(await readFile(toolFile)) }], prefix: [toolFile], connectionId, runtimeDirectories: packaged ? [bundle] : [], environment: packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}, networkPorts: [], program: { path: toolFile, name: 'fixture', sha256: sha(await readFile(toolFile)) }, argv: ['read'] }
  const broker = new PodToolBroker(helper, privateRoot, { operationId: randomUUID(), targetHost: identityConnection.targetHost, runtime: { executable, cli: packaged ? join(bundle, 'Resources/apes/ape-shell.mjs') : resolve('dist/vendor/apes/ape-shell.mjs') }, observer: { authorized: async () => {} } }, cache)
  return { assignment, broker, cache, connectionId, credentialRoot, state, identityConnection, helper, privateRoot, lease: { capabilities: ['fixture.read'], assertCurrent: () => {}, signal: new AbortController().signal }, request: { toolId: 'fixture', argv: ['read'] } }
}
describe('ape-shell broker native boundary', () => {
  it('preserves UTF-8 split across process output chunks', async () => {
    const fixture = await setup(false, false, true)
    const reply = await fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)
    expect(reply.exitCode).toBe(0)
    expect(reply.stdout).toContain('Grüße 日本語')
  })
  it('delivers only the assigned rotating credential in a separate sandbox (packaged)', async () => {
    const fixture = await setup(true)
    const reply = await fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)
    expect(reply.exitCode, reply.stderr).toBe(0)
    expect(JSON.parse(reply.stdout)).toEqual({ assigned: true, siblingDenied: true, childDenied: true })
    expect(reply.stderr).toContain('[REDACTED]'); expect(reply.stderr).not.toContain('SYNTHETIC_')
    await fixture.cache.withCache(fixture.connectionId, async file => expect(JSON.parse(await readFile(file, 'utf8')).access_token).toBe('SYNTHETIC_ROTATED_TOKEN'))
    expect(await readdir(join(fixture.credentialRoot, 'temporary'))).toEqual([])
    expect(fixture.state.requests.includes('POST /api/grants')).toBe(false)
  })
  it('rejects foreign identities, script capability expansion, stale assignments and changed artifacts before execution', async () => {
    const fixture = await setup()
    fixture.state.subject = 'owner@example.test'
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)).rejects.toThrow('another identity')
    fixture.state.subject = 'pod@example.test'
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, { ...fixture.lease, capabilities: [] })).rejects.toThrow('capability')
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, { ...fixture.lease, assertCurrent: () => { throw new Error('Stale resource epoch') } })).rejects.toThrow('Stale')
    await expect(fixture.broker.execute(fixture.assignment, { ...fixture.request, argv: ['send'] }, fixture.lease)).rejects.toThrow('assigned tool')
    await writeFile(fixture.assignment.entryFiles[0]!.path, 'throw new Error("CHANGED")')
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)).rejects.toThrow('integrity')
    // Only the identity check reached the IdP; nothing ran.
    expect(fixture.state.executions).toBe(1)
  })
  it('removes the plaintext cache of a cancelled tool and refuses the next call after identity revocation', async () => {
    const fixture = await setup(false, true)
    const run = new AbortController()
    const execution = fixture.broker.execute(fixture.assignment, fixture.request, { ...fixture.lease, signal: run.signal })
    const assertion = expect(execution).rejects.toThrow()
    await expect.poll(() => fixture.state.executions).toBe(1)
    await expect.poll(async () => (await readdir(join(fixture.credentialRoot, 'temporary'))).length).toBe(1)
    fixture.state.active = false
    run.abort()
    await assertion
    expect(await readdir(join(fixture.credentialRoot, 'temporary'))).toEqual([])
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)).rejects.toThrow('403 Forbidden')
    expect(fixture.state.executions).toBe(1)
  })
})

it('composes signed ape-shell authorization, scoped cache, TLS refresh and the actual o365 sandbox', async () => {
  const fixture = await setup(true)
  const tls = await mailTLSFixture(root)
  const vendor = join(fixture.privateRoot, 'vendor'); await mkdir(vendor)
  await Promise.all(['o365-cli', 'o365-manifest.json'].map(name => copyFile(join(resolve('.artifacts/o365-fixture'), name), join(vendor, name))))
  await copyFile(tls.certificate, join(vendor, 'mail-roots.pem'))
  const manifest = JSON.parse(await readFile(join(vendor, 'o365-manifest.json'), 'utf8'))
  manifest.rootsHash = sha(await readFile(tls.certificate)); await writeFile(join(vendor, 'o365-manifest.json'), JSON.stringify(manifest))
  await fixture.cache.connect(fixture.connectionId, await readFile(resolve('e2e/fixtures/msal-synthetic.json'), 'utf8'))
  const argv = ['o365-cli', 'pods', 'read', '--operation', 'messages', '--account', 'pod@example.invalid', '--folder', 'inbox']
  const proxy = await startNetworkProxy(fixture.lease.signal, ['graph.microsoft.com', 'login.microsoftonline.com'], tls.dial)
  const records: string[] = []
  try {
    const executable = join(vendor, 'o365-cli'); const rootsFile = join(vendor, 'mail-roots.pem')
    const assignment: ToolAssignment = { id: 'o365', identityConnection: fixture.identityConnection, capability: 'fixture.read', program: { path: executable, name: 'o365-cli', sha256: sha(await readFile(executable)) }, executable, executableHash: sha(await readFile(executable)), argv: argv.slice(1), prefix: [], entryFiles: [{ path: rootsFile, hash: sha(await readFile(rootsFile)) }], connectionId: fixture.connectionId, cacheArgument: '--cache-dir', runtimeDirectories: [], environment: { ...proxy.environment, PODS_CA_FILE: rootsFile }, networkPorts: [proxy.port], maxOutputBytes: 32 * 1024 * 1024, stdoutArtifact: true }
    const reply = await fixture.broker.execute(assignment, { toolId: 'o365', argv: argv.slice(1) }, { ...fixture.lease, workspace: fixture.privateRoot, registerDomain: async (path) => { records.push(path) } })
    expect(reply.exitCode, reply.stderr).toBe(0)
    const artifact = reply.stdoutArtifact!
    const raw = await readFile(artifact.path, 'utf8'); expect(sha(raw)).toBe(artifact.sha256)
    expect(JSON.parse(raw)).toMatchObject({ account: 'pod@example.invalid', complete: false })
    expect(fixture.state.executions).toBe(1); expect(records).toHaveLength(1)
    expect(tls.state).toMatchObject({ refreshes: 1, reads: 1 })
    expect(await readdir(join(fixture.credentialRoot, 'temporary'))).toEqual([])
    await fixture.cache.withCache(fixture.connectionId, async file => expect(await readFile(file, 'utf8')).toContain('SYNTHETIC_TLS_REFRESH'))
  }
  finally { await proxy.close(); await tls.close() }
})
