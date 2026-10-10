import { setTimeout as delay } from 'node:timers/promises'
import { operationalFixture } from '../../openape-pods/test/layout/network-fixture'
import { verifyBrowserWorkspace } from '../../openape-pods/test/workspace/browser-acceptance'
import { centralFixture, fullPublication } from '../../openape-pods/test/workspace/central-fixture'
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import type { RunningServer } from 'openape-e2e/lifecycle'
import { challenge, generateKey, proofBytes, publicKey, signBytes, sha256 } from '@openape/pods-protocol/crypto'
import type { Owner } from '@openape/pods-protocol'

let idp: RunningServer; let relay: RunningServer
const managementToken = 'pods-relay-disposable-fixture'
const email = 'owner@pods-relay.test'
beforeAll(async () => {
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'pods-relay.test': { version: 'ddisa1', idp: 'https://identity.example', mode: 'open' } } })
  relay = await startServer({ cwd: process.cwd(), readyPath: '/api/health', timeoutMs: 300000, env: ({ url }) => ({ NUXT_IGNORE_LOCK: '1', NUXT_WORKSPACE_ENABLED: 'true', NUXT_INBOX_ENABLED: 'true', NUXT_INBOX_DATABASE: `${makeTempDir('pods-inbox-e2e-')}/inbox.sqlite`, NUXT_WORKSPACE_DATABASE: `${makeTempDir('pods-workspace-e2e-')}/workspace.sqlite`, NUXT_WORKSPACE_SESSION_SECRET: 'synthetic-workspace-session-secret-1378', NUXT_OPENAPE_SP_SESSION_SECRET: 'synthetic-workspace-flow-secret-1378', NUXT_OPENAPE_SP_OPENAPE_URL: idp.url, NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_RELAY_ORIGIN: url, NUXT_RELAY_ENABLED: 'true', NUXT_RELAY_ENROLLMENT: 'pilot', NUXT_RELAY_OWNER_ALLOWLIST: JSON.stringify([{ issuer: idp.url, subject: email }]), NUXT_RELAY_FIXTURE: 'true', NUXT_RELAY_IDP_URL: idp.url, NUXT_RELAY_DATABASE: `${makeTempDir('pods-relay-e2e-')}/relay.sqlite` }) })
})
afterAll(async () => { if (relay) await relay.stop(); if (idp) await idp.stop() })
it('registers a desktop through real DDISA callbacks and rejects replayed handoffs and request proofs', async () => {
  const { privateKey, publicKey: loginKey } = generateKeyPairSync('ed25519')
  const ssh = keyObjectToSshString(loginKey, email)
  for (const [path, body] of [['/api/admin/users', { email, password: 'synthetic-pods-relay-password-123', name: 'Synthetic owner' }], [`/api/admin/users/${email}/ssh-keys`, { publicKey: ssh, name: 'Synthetic test key' }]] as const) {
    const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status, await response.text()).toBe(200)
  }
  const loginToken = await loginWithSshKey(idp.url, email, privateKey, ssh)
  async function signIn() {
    const key = generateKey(); const agreement = generateKey(); const deviceId = randomUUID(); const verifier = randomBytes(32).toString('base64url')
    async function post(path: string, body: unknown) { return fetch(`${relay.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' }) }
    const beginning = await post('/api/mobile/v1/session/begin', { deviceId, kind: 'runtime', keys: { signing: publicKey(key), agreement: publicKey(agreement) }, challenge: challenge(verifier), email })
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
    expect(returned.status, await returned.clone().text()).toBe(200)
    const request = { id: start.id, verifier, signature: signBytes(proofBytes('session-exchange', start.id, challenge(verifier)), key) }
    const badPkce = await post('/api/mobile/v1/session/exchange', { ...request, verifier: randomBytes(32).toString('base64url') })
    expect(badPkce.status).toBe(401)
    const response = await post('/api/mobile/v1/session/exchange', request)
    expect(response.status, await response.clone().text()).toBe(200)
    const result = await response.json() as { accessToken: string, registration: { id: string, owner: Owner, kind: string, generation: string, epoch: number } }
    expect(result.registration).toMatchObject({ id: deviceId, kind: 'runtime', owner: { issuer: idp.url, subject: email } })
    const replay = await post('/api/mobile/v1/session/exchange', request)
    expect(replay.status).toBe(410)
    return { ...result, key, agreement }
  }
  const desktop = await signIn()
  function headers(session: typeof desktop, path: string, method = 'GET', body = '') {
    const id = randomUUID(); const at = new Date().toISOString(); const digest = sha256(body)
    return { authorization: `Bearer ${session.accessToken}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': digest, 'x-pods-proof': signBytes(proofBytes('api-request', id, JSON.stringify([method, path, sha256(session.accessToken), at, digest])), session.key) }
  }
  const unauthenticated = await fetch(`${relay.url}/api/workspace/v1/inventory`)
  expect(unauthenticated.status).toBe(401)
  expect((await fetch(`${relay.url}/api/workspace/v1/session`)).status).toBe(401)
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
  const browserSession = await fetch(`${relay.url}/api/workspace/v1/session`, { headers: { cookie: webCookie } })
  expect(await browserSession.json()).toEqual({ subject: email })
  // Sign-in may resume only a same-origin inbox item; anything else falls back to the workspace.
  const item = `/inbox/item/${randomUUID()}?push=${randomUUID()}`
  for (const [returnTo, expected] of [[item, item], ['//evil.example/inbox/', '/workspace']]) {
    const resumed = await fetch(`${relay.url}/workspace-auth/login`, { method: 'POST', headers: { origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ email, returnTo }) })
    const cookie = resumed.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const granted = await fetch((await resumed.json() as { redirectUrl: string }).redirectUrl, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
    const callback = await fetch(granted.headers.get('location')!, { redirect: 'manual', headers: { cookie } })
    expect(callback.headers.get('location')).toBe(expected)
  }
  // Inbox (plan M1): the runtime publishes into its owner's inbox; the signed-in browser reads it without the runtime.
  const publishPath = '/api/runtime/v1/inbox'
  const publication = JSON.stringify({ eventId: 'e2e-message-1', kind: 'message', title: 'Belege', body: 'Rechnung abgelegt.' })
  for (const expected of [201, 200]) {
    const published = await fetch(`${relay.url}${publishPath}`, { method: 'POST', headers: { ...headers(desktop, publishPath, 'POST', publication), 'content-type': 'application/json' }, body: publication })
    expect(published.status, await published.clone().text()).toBe(expected)
  }
  // A workspace sign-in alone never opens the inbox; only a sign-in started by the inbox creates a device session.
  expect(await (await fetch(`${relay.url}/inbox/api/v1/items`, { headers: { cookie: webCookie } })).json()).toMatchObject({ code: 'authentication_required' })
  const inboxLogin = await fetch(`${relay.url}/workspace-auth/login`, { method: 'POST', headers: { origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ email, returnTo: '/inbox/' }) })
  const inboxFlow = inboxLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const inboxGrant = await fetch((await inboxLogin.json() as { redirectUrl: string }).redirectUrl, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
  const inboxCallback = await fetch(inboxGrant.headers.get('location')!, { redirect: 'manual', headers: { cookie: inboxFlow } })
  const inboxCookie = inboxCallback.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => !value.endsWith('=')).join('; ')
  const inboxRead = await fetch(`${relay.url}/inbox/api/v1/items`, { headers: { cookie: inboxCookie } })
  expect((await inboxRead.json() as { items: { title: string }[] }).items.map(entry => entry.title)).toEqual(['Belege'])
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
  const state = { version: 1 as const, workspace: { ...fixture.host.workspace, pods: [fixture.host.workspace.pods[0]!] }, pods: [fixture.view], artifacts: [{ podId: fixture.view.id, path: 'workspace/example.bin', hash: artifactHash, size: artifact.length }], blobs: [] }
  const workspacePublication = fullPublication(state)
  const publish = async (revision: number, completion?: unknown) => {
    await central({ type: 'parts', lease: session.lease, parts: workspacePublication.parts })
    return central({ type: 'publish', format: 2, lease: session.lease, id: randomUUID(), revision, changes: workspacePublication.changes, hash: workspacePublication.hash, ...(completion ? { completion } : {}) })
  }
  const published = await publish(0) as { hash: string }
  await central({ type: 'heartbeat', lease: session.lease, hash: published.hash })
  expect(await central({ type: 'claim', lease: session.lease })).toBeNull()
  await central({ type: 'heartbeat', lease: session.lease, hash: published.hash })
  // Decisions (plan M2): the runtime publishes its set; the phone decides through the central operation pipeline.
  const decisionsPath = '/api/runtime/v1/inbox/decisions'
  const decisionSet = JSON.stringify({ decisions: [{ sourceId: 'effect:e2e', type: 'effect', digest: 'a'.repeat(64), podId: fixture.view.id, podName: 'Monitor', title: 'Unklare Zustellung', body: 'Lauf', authority: 'pods', options: [{ key: 'delivered', title: 'Zugestellt', input: 'evidence' }], link: null }] })
  const synced = await fetch(`${relay.url}${decisionsPath}`, { method: 'POST', headers: { ...headers(desktop, decisionsPath, 'POST', decisionSet), 'content-type': 'application/json' }, body: decisionSet })
  expect(await synced.json()).toEqual({ created: 1, updated: 0, resolved: 0, skipped: 0 })
  const [decision] = (await (await fetch(`${relay.url}/inbox/api/v1/items?kind=decision`, { headers: { cookie: inboxCookie } })).json() as { items: { id: string }[] }).items
  const decide = (body: Record<string, unknown>) => fetch(`${relay.url}/inbox/api/v1/items/${decision!.id}/decide`, { method: 'POST', headers: { cookie: inboxCookie, origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ digest: 'a'.repeat(64), ...body }) })
  expect(await (await decide({ option: 'delivered', requestId: randomUUID() })).json()).toMatchObject({ code: 'invalid_inbox_input' })
  expect(await (await decide({ option: 'delivered', input: 'Gesehen', digest: 'b'.repeat(64), requestId: randomUUID() })).json()).toMatchObject({ code: 'decision_changed' })
  expect(await (await decide({ option: 'resend', input: 'Gesehen', requestId: randomUUID() })).json()).toMatchObject({ code: 'invalid_inbox_option' })
  const requestId = randomUUID()
  for (let attempt = 0; attempt < 2; attempt++) {
    const decided = await decide({ option: 'delivered', input: 'Gesehen', requestId })
    expect(decided.status, await decided.clone().text()).toBe(200)
    expect(await decided.json()).toMatchObject({ operation: { id: requestId, state: 'accepted', command: { channel: 'inbox', body: { type: 'decide', sourceId: 'effect:e2e', digest: 'a'.repeat(64), option: 'delivered', input: 'Gesehen' } } } })
  }
  expect(await central({ type: 'claim', lease: session.lease })).toMatchObject({ id: requestId, state: 'started' })
  const decidedState = await publish(1, { id: requestId, result: { status: 'applied', sourceId: 'effect:e2e' }, error: null }) as { revision: number }
  expect(await (await fetch(`${relay.url}/inbox/api/v1/operations/${requestId}`, { headers: { cookie: inboxCookie } })).json()).toMatchObject({ operation: { id: requestId, state: 'applied' } })
  // Any later sign-in in this browser that is not started by the inbox ends its inbox session (account switch).
  const switched = await fetch(`${relay.url}/workspace-auth/login`, { method: 'POST', headers: { origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  const switchFlow = [inboxCookie, ...switched.headers.getSetCookie().map(value => value.split(';')[0])].join('; ')
  const switchGrant = await fetch((await switched.json() as { redirectUrl: string }).redirectUrl, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
  await fetch(switchGrant.headers.get('location')!, { redirect: 'manual', headers: { cookie: switchFlow } })
  const revoked = await fetch(`${relay.url}/inbox/api/v1/items`, { headers: { cookie: inboxCookie } })
  expect(await revoked.json()).toMatchObject({ code: 'session_revoked' })
  const workspaceInventory = await fetch(`${relay.url}/api/workspace/v1/inventory`, { headers: { cookie: webCookie } })
  expect(workspaceInventory.status, await workspaceInventory.clone().text()).toBe(200)
  expect(await workspaceInventory.json()).toMatchObject([{ id: desktop.registration.id, online: true }])
  expect(workspaceInventory.headers.get('cache-control')).toContain('no-store')
  const network = operationalFixture()
  network.view.networks[0]!.podIds = [fixture.view.id]
  network.view.details!.definition.members = [{ ...network.definition.members[0]!, podId: fixture.view.id }]
  network.view.details!.members = [{ ...network.setup.members[0]!, podId: fixture.view.id }]
  await central({ type: 'networks', lease: session.lease, view: { networks: network.view.networks } })
  const queryBody = { runtimeId: desktop.registration.id, command: { type: 'list' } }
  const anonymousRead = await fetch(`${relay.url}/api/workspace/v1/networks`, { method: 'POST', headers: { origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify(queryBody) })
  expect(anonymousRead.status).toBe(401)
  const crossSiteRead = await fetch(`${relay.url}/api/workspace/v1/networks`, { method: 'POST', headers: { cookie: webCookie, origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify(queryBody) })
  expect(crossSiteRead.status).toBe(403)
  const deniedMutation = await fetch(`${relay.url}/api/workspace/v1/networks`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify({ ...queryBody, command: { type: 'activate', id: network.networkId, revision: 1 } }) })
  expect(deniedMutation.status).toBe(400)
  const serving = new AbortController()
  const responder = (async () => {
    while (!serving.signal.aborted) {
      await central({ type: 'heartbeat', lease: session.lease, hash: published.hash })
      const query = await central({ type: 'readClaim', lease: session.lease }) as { id: string } | null
      if (query) await central({ type: 'readComplete', lease: session.lease, id: query.id, value: network.view, error: null })
      await delay(1000)
    }
  })()
  const browserCheck = (async () => {
    try { await verifyBrowserWorkspace(relay.url, email, loginToken, network.definition.name) }
    finally { serving.abort() }
  })()
  const results = await Promise.allSettled([browserCheck, responder])
  for (const result of results) { if (result.status === 'rejected') throw result.reason }
  const download = await fetch(`${relay.url}/api/workspace/v1/artifact?runtimeId=${desktop.registration.id}&podId=${fixture.view.id}&path=workspace/example.bin`, { headers: { cookie: webCookie } })
  expect(download.status).toBe(200)
  expect(sha256(new Uint8Array(await download.arrayBuffer()))).toBe(artifactHash)
  const command = { runtimeId: desktop.registration.id, revision: decidedState.revision, id: randomUUID(), command: { channel: 'details', body: { type: 'describe', podId: fixture.view.id, text: 'Browser edit', revision: 1 } } }
  const crossSite = await fetch(`${relay.url}/api/workspace/v1/commands`, { method: 'POST', headers: { cookie: webCookie, origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify(command) })
  expect(crossSite.status).toBe(403)
  const submitted = await fetch(`${relay.url}/api/workspace/v1/commands`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify(command) })
  expect(submitted.status, await submitted.clone().text()).toBe(202)
  expect(await central({ type: 'claim', lease: session.lease })).toMatchObject({ id: command.id, state: 'started' })
  await central({ type: 'disconnect', lease: session.lease })
  const unavailable = await fetch(`${relay.url}/api/workspace/v1/pod?runtimeId=${desktop.registration.id}&podId=${fixture.view.id}`, { headers: { cookie: webCookie } })
  expect(unavailable.status).toBe(409)
  const offlineRead = await fetch(`${relay.url}/api/workspace/v1/networks`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url, 'content-type': 'application/json' }, body: JSON.stringify(queryBody) })
  expect(offlineRead.status).toBe(409)
  expect(await offlineRead.text()).toContain('workspace_runtime_offline')
  const signOut = await fetch(`${relay.url}/workspace-auth/logout`, { method: 'POST', headers: { cookie: webCookie, origin: relay.url } })
  expect(signOut.status).toBe(200)
  const registrationPath = '/api/runtime/v1/registration'
  const proof = headers(desktop, registrationPath)
  const registration = await fetch(`${relay.url}${registrationPath}`, { headers: proof })
  expect(await registration.json()).toMatchObject({ id: desktop.registration.id, kind: 'runtime' })
  expect((await fetch(`${relay.url}${registrationPath}`, { headers: proof })).status).toBe(401)
  expect((await fetch(`${relay.url}${registrationPath}`, { headers: { authorization: `Bearer ${desktop.accessToken}` } })).status).toBe(401)
})
