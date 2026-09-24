import { centralFixture } from '../../openape-pods/test/workspace/central-fixture'
import { capabilities } from '@openape/pods-protocol'
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import type { RunningServer } from 'openape-e2e/lifecycle'
import { challenge, generateKey, proofBytes, publicKey, signBytes, sha256, seal, open } from '@openape/pods-protocol/crypto'
import type { Owner, Route, SealedEnvelope } from '@openape/pods-protocol'

let idp: RunningServer; let relay: RunningServer
const managementToken = 'pods-relay-disposable-fixture'
const email = 'owner@pods-mobile.test'
beforeAll(async () => {
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'pods-mobile.test': { version: 'ddisa1', idp: 'https://identity.example', mode: 'open' } } })
  relay = await startServer({ cwd: process.cwd(), readyPath: '/api/health', timeoutMs: 300000, env: ({ url }) => ({ NUXT_IGNORE_LOCK: '1', NUXT_WORKSPACE_ENABLED: 'true', NUXT_WORKSPACE_DATABASE: `${makeTempDir('pods-workspace-e2e-')}/workspace.sqlite`, NUXT_WORKSPACE_SESSION_SECRET: 'synthetic-workspace-session-secret-1378', NUXT_OPENAPE_SP_SESSION_SECRET: 'synthetic-workspace-flow-secret-1378', NUXT_OPENAPE_SP_OPENAPE_URL: idp.url, NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_RELAY_ORIGIN: url, NUXT_RELAY_ENABLED: 'true', NUXT_RELAY_ENROLLMENT: 'pilot', NUXT_RELAY_OWNER_ALLOWLIST: JSON.stringify([{ issuer: idp.url, subject: email }]), NUXT_RELAY_FIXTURE: 'true', NUXT_RELAY_IDP_URL: idp.url, NUXT_RELAY_DATABASE: `${makeTempDir('pods-relay-e2e-')}/relay.sqlite` }) })
})
afterAll(async () => { if (relay) await relay.stop(); if (idp) await idp.stop() })
it('registers a desktop and mobile through real DDISA callbacks and rejects replayed native handoffs', async () => {
  const { privateKey, publicKey: loginKey } = generateKeyPairSync('ed25519')
  const ssh = keyObjectToSshString(loginKey, email)
  for (const [path, body] of [['/api/admin/users', { email, password: 'synthetic-pods-mobile-password-123', name: 'Synthetic owner' }], [`/api/admin/users/${email}/ssh-keys`, { publicKey: ssh, name: 'Synthetic test key' }]] as const) {
    const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status, await response.text()).toBe(200)
  }
  const loginToken = await loginWithSshKey(idp.url, email, privateKey, ssh)
  async function signIn(kind: 'runtime' | 'mobile') {
    const key = generateKey(); const agreement = generateKey(); const deviceId = randomUUID(); const verifier = randomBytes(32).toString('base64url')
    async function post(path: string, body: unknown) { return fetch(`${relay.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' }) }
    const beginning = await post('/api/mobile/v1/session/begin', { deviceId, kind, keys: { signing: publicKey(key), agreement: publicKey(agreement) }, challenge: challenge(verifier), email })
    expect(beginning.status, await beginning.clone().text()).toBe(200)
    const start = await beginning.json() as { id: string, browserUrl: string }
    const browser = await fetch(start.browserUrl, { redirect: 'manual' })
    expect(browser.status, await browser.clone().text()).toBe(302)
    const cookie = browser.headers.get('set-cookie')!.split(';')[0]!
    const authorization = await fetch(browser.headers.get('location')!, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
    expect(authorization.status, await authorization.clone().text()).toBe(302)
    const callback = authorization.headers.get('location')!
    const rejected = await fetch(callback, { redirect: 'manual' })
    expect(rejected.status).toBe(401)
    const returned = await fetch(callback, { redirect: 'manual', headers: { cookie } })
    expect([200, 302], await returned.clone().text()).toContain(returned.status)
    const code = kind === 'mobile' ? new URL(returned.headers.get('location')!).searchParams.get('code')! : undefined
    const request = { id: start.id, code, verifier, signature: signBytes(proofBytes('session-exchange', start.id, challenge(verifier)), key) }
    const badPkce = await post('/api/mobile/v1/session/exchange', { ...request, verifier: randomBytes(32).toString('base64url') })
    expect(badPkce.status).toBe(401)
    const response = await post('/api/mobile/v1/session/exchange', request)
    expect(response.status, await response.clone().text()).toBe(200)
    const result = await response.json() as { accessToken: string, registration: { id: string, owner: Owner, kind: string, generation: string, epoch: number } }
    expect(result.registration).toMatchObject({ id: deviceId, kind, owner: { issuer: idp.url, subject: email } })
    const replay = await post('/api/mobile/v1/session/exchange', request)
    expect(replay.status).toBe(410)
    return { ...result, key, agreement }
  }
  const desktop = await signIn('runtime')
  const mobile = await signIn('mobile')
  function headers(session: typeof desktop, path: string, method = 'GET', body = '') {
    const id = randomUUID(); const at = new Date().toISOString(); const digest = sha256(body)
    return { authorization: `Bearer ${session.accessToken}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': digest, 'x-pods-proof': signBytes(proofBytes('api-request', id, JSON.stringify([method, path, sha256(session.accessToken), at, digest])), session.key) }
  }
  const unauthenticated = await fetch(`${relay.url}/api/workspace/v1/inventory`)
  expect(unauthenticated.status).toBe(401)
  const login = await fetch(`${relay.url}/workspace-auth/login`, { method: 'POST', headers: { origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  expect(login.status, await login.clone().text()).toBe(200)
  const flowCookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const { redirectUrl } = await login.json() as { redirectUrl: string }
  const authorize = await fetch(redirectUrl, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
  expect(authorize.status, await authorize.clone().text()).toBe(302)
  const webCallback = authorize.headers.get('location')!
  const webLogin = await fetch(webCallback, { redirect: 'manual', headers: { cookie: flowCookie } })
  expect(webLogin.headers.get('location'), await webLogin.clone().text()).toBe('/workspace')
  const webCookie = webLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const runtimePath = '/api/runtime/v1/workspace'
  async function central(body: Record<string, unknown>) {
    const encoded = JSON.stringify(body)
    const response = await fetch(`${relay.url}${runtimePath}`, { method: 'POST', headers: { ...headers(desktop, runtimePath, 'POST', encoded), 'content-type': 'application/json' }, body: encoded })
    expect(response.status, await response.clone().text()).toBe(200)
    return response.json()
  }
  const session = await central({ type: 'begin' }) as { lease: string }
  const fixture = centralFixture()
  const artifact = Buffer.alloc(2 * 1024 * 1024, 42)
  const artifactHash = sha256(artifact)
  await central({ type: 'artifact', lease: session.lease, podId: fixture.view.id, hash: artifactHash, content: artifact.toString('base64') })
  const invalidArtifact = JSON.stringify({ type: 'artifact', lease: session.lease, podId: fixture.view.id, hash: artifactHash, content: 'not base64' })
  const invalidUpload = await fetch(`${relay.url}${runtimePath}`, { method: 'POST', headers: { ...headers(desktop, runtimePath, 'POST', invalidArtifact), 'content-type': 'application/json' }, body: invalidArtifact })
  expect(invalidUpload.status).toBe(400)
  const state = { version: 1, workspace: { ...fixture.host.workspace, pods: [fixture.host.workspace.pods[0]] }, pods: [fixture.view], archive: { schema: 23, tables: {} }, artifacts: [{ podId: fixture.view.id, path: 'workspace/example.bin', hash: artifactHash, size: artifact.length }] }
  const published = await central({ type: 'publish', lease: session.lease, id: randomUUID(), revision: 0, snapshot: state }) as { hash: string }
  await central({ type: 'heartbeat', lease: session.lease, hash: published.hash })
  const workspaceInventory = await fetch(`${relay.url}/api/workspace/v1/inventory`, { headers: { cookie: webCookie } })
  expect(workspaceInventory.status, await workspaceInventory.clone().text()).toBe(200)
  expect(await workspaceInventory.json()).toMatchObject([{ id: desktop.registration.id, online: true }])
  expect(workspaceInventory.headers.get('cache-control')).toContain('no-store')
  const download = await fetch(`${relay.url}/api/workspace/v1/artifact?runtimeId=${desktop.registration.id}&podId=${fixture.view.id}&path=workspace/example.bin`, { headers: { cookie: webCookie } })
  expect(download.status).toBe(200)
  expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(artifactHash)
  const command = { runtimeId: desktop.registration.id, revision: 1, id: randomUUID(), command: { channel: 'details', body: { type: 'describe', podId: fixture.view.id, text: 'Browser edit', revision: 1 } } }
  const crossSite = await fetch(`${relay.url}/api/workspace/v1/commands`, { method: 'POST', headers: { cookie: webCookie, origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify(command) })
  expect(crossSite.status).toBe(403)
  const submitted = await fetch(`${relay.url}/api/workspace/v1/commands`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  expect(submitted.status, await submitted.clone().text()).toBe(202)
  await central({ type: 'disconnect', lease: session.lease })
  const unavailable = await fetch(`${relay.url}/api/workspace/v1/pod?runtimeId=${desktop.registration.id}&podId=${fixture.view.id}`, { headers: { cookie: webCookie } })
  expect(unavailable.status).toBe(409)
  const signOut = await fetch(`${relay.url}/workspace-auth/logout`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url } })
  expect(signOut.status).toBe(200)
  const path = '/api/mobile/v1/runtimes'
  const proof = headers(mobile, path)
  const inventory = await fetch(`${relay.url}${path}`, { headers: proof })
  expect(await inventory.json()).toMatchObject([{ id: desktop.registration.id, online: false }])
  const replay = await fetch(`${relay.url}${path}`, { headers: proof })
  expect(replay.status).toBe(401)
  const stolen = await fetch(`${relay.url}${path}`, { headers: { authorization: `Bearer ${mobile.accessToken}` } })
  expect(stolen.status).toBe(401)
  const wrongActor = await fetch(`${relay.url}${path}`, { headers: headers(desktop, path) })
  expect(wrongActor.status).toBe(403)
  const socket = new WebSocket(`${relay.url.replace('http:', 'ws:')}/api/runtime/v1/connect`)
  const frames: Record<string, unknown>[] = []
  socket.addEventListener('message', event => frames.push(JSON.parse(String(event.data))))
  async function frame(type: string) {
    await expect.poll(() => frames.some(item => item.type === type), { timeout: 5000 }).toBe(true)
    return frames.splice(frames.findIndex(item => item.type === type), 1)[0]!
  }
  try {
    const challenge = await frame('challenge')
    socket.send(JSON.stringify({ type: 'authenticate', protocol: 1, capabilities, token: desktop.accessToken, signature: signBytes(proofBytes('runtime-connect', String(challenge.id), String(challenge.nonce)), desktop.key) }))
    await frame('ready')
    socket.send(JSON.stringify({ type: 'pair', deviceId: mobile.registration.id }))
    await frame('paired')
    const route: Route = { protocol: 'pods-mobile', major: 1, minor: 0, id: randomUUID(), runtimeId: desktop.registration.id, generation: desktop.registration.generation, deviceId: mobile.registration.id, keyEpoch: 1, owner: mobile.registration.owner, direction: 'command', kind: 'pod.create', kindVersion: 1, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), sequence: '0' }
    const envelope = seal(route, { name: 'Synthetic transport test' }, publicKey(desktop.agreement), mobile.key)
    const operationsPath = '/api/mobile/v1/operations'; const body = JSON.stringify(envelope)
    const posted = await fetch(`${relay.url}${operationsPath}`, { method: 'POST', headers: { ...headers(mobile, operationsPath, 'POST', body), 'content-type': 'application/json' }, body })
    expect(posted.status, await posted.clone().text()).toBe(202)
    const delivered = (await frame('operation')).envelope as SealedEnvelope
    expect(open(delivered, desktop.agreement, publicKey(mobile.key))).toEqual({ name: 'Synthetic transport test' })
    const receipt = { receipt: { operationId: route.id, state: 'applied', source: 'desktop', updatedAt: new Date().toISOString() }, data: { transportOnly: true } }
    const reply = seal({ ...route, direction: 'response', kind: 'receipt' }, receipt, publicKey(mobile.agreement), desktop.key)
    socket.send(JSON.stringify({ type: 'deliver', envelope: reply }))
    await frame('ack')
    const eventsPath = '/api/mobile/v1/events?cursor=0'
    const events = await fetch(`${relay.url}${eventsPath}`, { headers: headers(mobile, eventsPath) })
    const page = await events.json() as { events: { cursor: string, envelope: SealedEnvelope }[] }
    expect(page.events).toHaveLength(1)
    expect(open(page.events[0]!.envelope, mobile.agreement, publicKey(desktop.key))).toEqual(receipt)
    const pendingRoute: Route = { ...route, id: randomUUID() }
    const pendingBody = JSON.stringify(seal(pendingRoute, { name: 'Admitted before the desktop restored a backup' }, publicKey(desktop.agreement), mobile.key))
    const pendingPosted = await fetch(`${relay.url}${operationsPath}`, { method: 'POST', headers: { ...headers(mobile, operationsPath, 'POST', pendingBody), 'content-type': 'application/json' }, body: pendingBody })
    expect(pendingPosted.status, await pendingPosted.clone().text()).toBe(202)
    await frame('operation')
    const rotatePath = '/api/runtime/v1/rotate'
    const rotated = await fetch(`${relay.url}${rotatePath}`, { method: 'POST', headers: { ...headers(desktop, rotatePath, 'POST', '{}'), 'content-type': 'application/json' }, body: '{}' })
    expect(rotated.status, await rotated.clone().text()).toBe(200)
    const renewed = await rotated.json() as { id: string, generation: string }
    expect(renewed.id).toBe(desktop.registration.id)
    expect(renewed.generation).not.toBe(desktop.registration.generation)
    await expect.poll(() => socket.readyState).toBe(WebSocket.CLOSED)
    const runtimesAfter = await fetch(`${relay.url}${path}`, { headers: headers(mobile, path) })
    expect(await runtimesAfter.json()).toMatchObject([{ id: desktop.registration.id, generation: renewed.generation, online: false, paired: false }])
    const operationPath = `/api/mobile/v1/operations/${pendingRoute.id}`
    const unpaired = await fetch(`${relay.url}${operationPath}`, { headers: headers(mobile, operationPath) })
    expect(unpaired.status).toBe(403)
    const staleBody = JSON.stringify(seal({ ...route, id: randomUUID() }, { name: 'Old generation' }, publicKey(desktop.agreement), mobile.key))
    const stale = await fetch(`${relay.url}${operationsPath}`, { method: 'POST', headers: { ...headers(mobile, operationsPath, 'POST', staleBody), 'content-type': 'application/json' }, body: staleBody })
    expect(stale.status).toBe(404)
    const revokePath = `/api/mobile/v1/runtimes/${desktop.registration.id}`
    const revoke = await fetch(`${relay.url}${revokePath}`, { method: 'DELETE', headers: headers(mobile, revokePath, 'DELETE') })
    expect(revoke.status).toBe(200)
    await expect.poll(() => socket.readyState).toBe(WebSocket.CLOSED)
  }
  finally { socket.close() }

})
