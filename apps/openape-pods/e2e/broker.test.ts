import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialCache } from '../src/main/connections/cache'
import { AgentAuthority } from '../src/main/broker/authorization'
import { PodToolBroker } from '../src/main/broker/tools'
import type { ToolAssignment } from '../src/main/broker/tools'

let root = ''
let server: Server | undefined
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  server = undefined
  if (root) await rm(root, { recursive: true, force: true })
})
async function setup(packaged = false, slow = false) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-tool-broker-')))
  const privateRoot = join(root, 'private'); await mkdir(privateRoot)
  const credentialRoot = join(root, 'credentials')
  const cache = new CredentialCache(credentialRoot, { available: () => true, encrypt: value => Buffer.from(Buffer.from(value).map(byte => byte ^ 85)), decrypt: value => Buffer.from(value.map(byte => byte ^ 85)).toString() })
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
${slow ? 'setInterval(()=>{},1000);' : ''}`)
  const adapterPath = join(privateRoot, 'fixture.toml')
  await writeFile(adapterPath, 'schema="openape-shapes/v1"\n[cli]\nid="fixture"\nexecutable="fixture"\naudience="shapes"\n[[operation]]\nid="cache.read"\ncommand=["read"]\ndisplay="Read synthetic connection"\naction="read"\nrisk="low"\nresource_chain=["cache:*"]\n')
  const loaded = loadAdapter('fixture', adapterPath); const command = await resolveCommand(loaded, ['fixture', 'read'])
  const keys = generateKeyPairSync('ed25519'); const state = { active: true, grantActive: true, subject: 'pod@example.test', requests: [] as string[], executions: 0 }
  let origin = ''
  server = createServer((request, response) => {
    state.requests.push(`${request.method} ${request.url}`); response.setHeader('Content-Type', 'application/json')
    if (request.url === '/.well-known/jwks.json') { response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] })); return }
    if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: state.active, keyIds: ['pod-key'], grantId: 'assigned', grantActive: state.grantActive })); return }
    if (request.url === '/api/grants/assigned/token') {
      const now = Math.floor(Date.now() / 1000)
      const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: origin, sub: state.subject, aud: 'shapes', target_host: 'fixture-mac', grant_id: 'assigned', grant_type: 'always', iat: now, exp: now + 60, jti: randomUUID(), authorization_details: [command.detail], execution_context: command.executionContext })).toString('base64url')
      const signature = sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')
      response.end(JSON.stringify({ authz_jwt: `${head}.${payload}.${signature}` })); return
    }
    if (request.url === '/api/grants/assigned/consume') { state.executions++; response.end(JSON.stringify(state.grantActive ? { status: 'valid' } : { error: 'revoked' })); return }
    response.statusCode = 404; response.end('{}')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  origin = `http://127.0.0.1:${address.port}`
  const authority = new AgentAuthority({ issuer: origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'pod-key', targetHost: 'fixture-mac', accessToken: async () => 'SYNTHETIC_AGENT_BEARER' })
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
  const executable = packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath
  const helper = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist/native/pods-helper') : resolve('dist/native/pods-helper')
  const assignment: ToolAssignment = { id: 'fixture', capability: 'fixture.read', executable, executableHash: sha(await readFile(executable)), entryFiles: [{ path: toolFile, hash: sha(await readFile(toolFile)) }], prefix: [toolFile], connectionId, runtimeDirectories: packaged ? [bundle] : [], environment: packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {}, networkPorts: [], grantId: 'assigned', command: { cliId: 'fixture', adapterPath, adapterDigest: loaded.digest, argv: ['fixture', 'read'], permission: command.permission } }
  const broker = new PodToolBroker(helper, privateRoot, authority, cache)
  return { assignment, broker, cache, connectionId, credentialRoot, state, lease: { capabilities: ['fixture.read'], assertCurrent: () => {}, signal: new AbortController().signal }, request: { toolId: 'fixture', argv: ['fixture', 'read'] } }
}
describe('ape-shell broker native boundary', () => {
  it.each([false, true])('delivers only the assigned rotating credential in a separate sandbox (packaged=%s)', async (packaged) => {
    const fixture = await setup(packaged)
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
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)).rejects.toThrow('assigned identity')
    fixture.state.subject = 'pod@example.test'
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, { ...fixture.lease, capabilities: [] })).rejects.toThrow('capability')
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, { ...fixture.lease, assertCurrent: () => { throw new Error('Stale resource epoch') } })).rejects.toThrow('Stale')
    await expect(fixture.broker.execute(fixture.assignment, { ...fixture.request, argv: ['fixture', 'send'] }, fixture.lease)).rejects.toThrow('assigned tool')
    await writeFile(fixture.assignment.entryFiles[0]!.path, 'throw new Error("CHANGED")')
    await expect(fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)).rejects.toThrow('integrity')
    expect(fixture.state.executions).toBe(0)
  })
  it('stops an active tool after identity revocation and removes its plaintext cache', async () => {
    const fixture = await setup(false, true)
    const execution = fixture.broker.execute(fixture.assignment, fixture.request, fixture.lease)
    const assertion = expect(execution).rejects.toThrow('no longer active')
    await expect.poll(() => fixture.state.executions).toBe(1)
    await expect.poll(async () => (await readdir(join(fixture.credentialRoot, 'temporary'))).length).toBe(1)
    fixture.state.active = false
    await assertion
    expect(await readdir(join(fixture.credentialRoot, 'temporary'))).toEqual([])
  })
})
