import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import { startServer, makeTempDir } from 'openape-e2e/lifecycle'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { recordedResponse } from '../../openape-pods/e2e/fixtures/responses.ts'
import { certificate, tlsProxy } from './tls.mjs'

async function until(read, description, timeout = 30000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const result = await read()
    if (result) return result
    await delay(200)
  }
  throw new Error(`Timed out: ${description}`)
}
async function json(url, body, headers = {}) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal(response.status, 200, `${new URL(url).pathname}: ${await response.clone().text()}`)
  return response.json()
}
export async function startAcceptance(family) {
  const root = makeTempDir('pods-native-acceptance-'); const cleanups = []
  const failures = []; const requests = []; let app; let idp; let ownerToken; let ownerCookie
  const email = `owner-${randomUUID()}@pods-native.test`
  const controlToken = randomUUID()
  const expectedResult = `Desktop CLI result ${randomUUID()}`
  const keys = generateKeyPairSync('ed25519'); const ssh = keyObjectToSshString(keys.publicKey, email)
  const tls = await certificate(root)
  setDefaultCACertificates([...getCACertificates('default'), tls.cert.toString()])
  async function close() {
    console.log('Native acceptance paths:', JSON.stringify(requests.filter(item => !item.includes('GET') || !item.some(value => String(value).startsWith('/_nuxt/')))))
    const errors = []
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch (error) { errors.push(error) }
    }
    await rm(root, { recursive: true, force: true })
    if (errors.length) throw new AggregateError(errors, 'Native acceptance cleanup failed')
  }
  try {
    const identity = await tlsProxy(tls, async (request, response, body) => {
      const path = new URL(request.url, 'https://fixture.test').pathname
      requests.push(['idp', request.method, path, response.statusCode])
      if (!path.startsWith('/_nuxt/')) console.log('Identity fixture:', request.method, path, response.statusCode)
      if (request.method !== 'POST' || request.url !== '/api/session/qr' || response.statusCode !== 200) return
      const { channelId } = JSON.parse(body)
      assert.match(channelId, /^[A-Za-z0-9_-]+$/)
      await json(`${idp.url}/api/session/qr/${channelId}/approve`, {}, { cookie: ownerCookie })
    })
    cleanups.push(identity.close)
    const identityDatabase = join(root, 'identity.sqlite')
    idp = await startServer({ cwd: resolve('../openape-free-idp'), readyPath: '/.well-known/openid-configuration', timeoutMs: 300000, env: {
      NUXT_IGNORE_LOCK: '1', OPENAPE_E2E: '0', OPENAPE_ISSUER: identity.origin,
      OPENAPE_RP_ORIGIN: identity.origin, OPENAPE_RP_ID: '127.0.0.1', OPENAPE_RP_HOST_ALLOWLIST: 'pods-native.test',
      OPENAPE_SESSION_SECRET: randomUUID(), OPENAPE_MANAGEMENT_TOKEN: '', OPENAPE_ADMIN_EMAILS: '',
      NUXT_TURSO_URL: `file:${identityDatabase}`, NUXT_TURSO_AUTH_TOKEN: '',
      NUXT_RESEND_API_KEY: '', NUXT_TELEGRAM_BOT_TOKEN: '', NUXT_VAPID_PRIVATE_KEY: '',
      DDISA_MOCK_RECORDS: JSON.stringify({ 'pods-native.test': { version: 'ddisa1', idp: identity.origin, mode: 'open' } }),
      NODE_EXTRA_CA_CERTS: tls.path,
    } })
    cleanups.push(idp.stop); identity.forward(idp.url)
    assert.equal((await fetch(`${idp.url}/login`)).status, 200, 'warm up the disposable IdP login page before the native sign-in')
    const identityStore = new DatabaseSync(identityDatabase)
    try {
      const createdAt = Math.floor(Date.now() / 1000)
      identityStore.prepare('INSERT INTO users(email,name,type,is_active,created_at) VALUES(?,?,?,?,?)').run(email, 'Native acceptance owner', 'human', 1, createdAt)
      identityStore.prepare('INSERT INTO ssh_keys(key_id,user_email,public_key,name,created_at) VALUES(?,?,?,?,?)').run(createHash('sha256').update(Buffer.from(ssh.split(' ')[1], 'base64')).digest('hex'), email, ssh, 'Disposable acceptance key', createdAt)
    }
    finally { identityStore.close() }
    ownerToken = await loginWithSshKey(idp.url, email, keys.privateKey, ssh)
    const challenge = await json(`${idp.url}/api/auth/challenge`, { id: email })
    const session = await fetch(`${idp.url}/api/session/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: email, challenge: challenge.challenge, signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString('base64'), public_key: ssh }) })
    assert.equal(session.status, 200)
    ownerCookie = session.headers.getSetCookie().map(item => item.split(';')[0]).join('; ')
    assert.ok(ownerCookie)
    const mediation = await tlsProxy(tls, async (request, response) => { requests.push([request.method, new URL(request.url, 'https://fixture.test').pathname, response.statusCode]) }, true); cleanups.push(mediation.close)
    const relay = await startServer({ cwd: resolve('../openape-pods-relay'), readyPath: '/api/health', timeoutMs: 300000, env: {
      NUXT_IGNORE_LOCK: '1', NUXT_RELAY_ORIGIN: mediation.origin, NUXT_RELAY_ENABLED: 'true', NUXT_RELAY_ENROLLMENT: 'pilot',
      NUXT_RELAY_OWNER_ALLOWLIST: JSON.stringify([{ issuer: identity.origin, subject: email }]), NUXT_RELAY_FIXTURE: 'true',
      NUXT_RELAY_IDP_URL: identity.origin, NUXT_RELAY_DATABASE: join(root, 'relay.sqlite'), NODE_EXTRA_CA_CERTS: tls.path,
    } })
    cleanups.push(relay.stop); mediation.forward(relay.url)
    const profile = join(root, 'desktop'); await mkdir(profile, { mode: 0o700 })
    const cli = join(root, 'mobile-acceptance'); const descriptor = `${cli}.toml`; const source = `${cli}.c`
    await writeFile(source, `#include <stdio.h>\nint main(void) { puts(${JSON.stringify(expectedResult)}); return 0; }\n`)
    await promisify(execFile)('/usr/bin/xcrun', ['clang', source, '-o', cli])
    await writeFile(descriptor, 'schema="openape-shapes/v1"\n[cli]\nid="mobile-acceptance"\nexecutable="mobile-acceptance"\naudience="shapes"\n[[operation]]\nid="read"\ncommand=["read"]\ndisplay="Read native acceptance result"\naction="read"\nrisk="low"\nresource_chain=["acceptance:*"]\n')
    const code = 'export async function run(context) { const result = await context.tools.invoke({application:"mobile-acceptance",argv:["read"]}); if(result.exitCode!==0) throw new Error("CLI failed"); return {status:"completed",summary:result.stdout.trim(),completedInputIds:[],gapIds:[]}; }'
    let modelCalls = 0
    const model = createHttpServer((request, response) => {
      const handle = async () => {
        let raw = ''; for await (const chunk of request) raw += chunk
        const body = JSON.parse(raw)
        if (raw.includes('previousDescription')) { response.setHeader('content-type', 'text/event-stream'); response.end(await recordedResponse({ type: 'message', id: 'description', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ description: 'Reads a harmless result from the explicitly assigned desktop CLI.' }), annotations: [] }] }).text()); return }
        const store = new DatabaseSync(join(profile, 'control.sqlite'), { readOnly: true })
        let action
        try {
          const pod = store.prepare('SELECT id,revision FROM pods').get(); assert.ok(pod)
          const draft = store.prepare('SELECT id,revision,validation FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(pod.id)
          const resource = store.prepare('SELECT configuration FROM resources WHERE pod_id=? AND kind=\'tool\'').get(pod.id)
          assert.ok(resource, 'The owner must assign the offered CLI before chat setup')
          const configuration = JSON.parse(resource.configuration)
          const scope = { podId: pod.id, revision: pod.revision }
          const actions = [
            { action: 'draft', ...scope, draftId: null, draftRevision: 0, code, capabilities: [configuration.capability] },
            { action: 'validate', ...scope, draftId: draft?.id, draftRevision: draft?.revision },
            { action: 'activate', ...scope, draftId: draft?.id, draftRevision: draft?.revision },
          ]
          action = actions[modelCalls++]
          if (action?.action === 'activate') assert.ok(draft?.validation, 'The draft must pass actual desktop validation before activation review')
        }
        finally { store.close() }
        assert.ok(Array.isArray(body.input))
        const reply = recordedResponse(action ? { type: 'function_call', id: `item-${modelCalls}`, call_id: `call-${modelCalls}`, name: 'pods_control', arguments: JSON.stringify(action) } : { type: 'message', id: 'prepared', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'The reviewed desktop script is ready.', annotations: [] }] })
        response.setHeader('content-type', 'text/event-stream'); response.end(await reply.text())
      }
      void handle().catch(error => { failures.push(String(error)); response.destroy(error) })
    })
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve)); cleanups.push(async () => { model.closeAllConnections(); await new Promise(resolve => model.close(resolve)) })
    let page
    async function launchDesktop() {
      app = await electron.launch({ executablePath: resolve('../openape-pods/release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), args: [], cwd: resolve('../openape-pods'), env: {
        HOME: homedir(), TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: profile,
        OPENAPE_PODS_FIXTURE_MODEL_PORT: String(model.address().port), NODE_ENV: 'test', OPENAPE_PODS_REMOTE_ENABLED: '1',
        OPENAPE_PODS_FIXTURE_RELAY_ORIGIN: mediation.origin, NODE_EXTRA_CA_CERTS: tls.path,
        DDISA_MOCK_RECORDS: JSON.stringify({ 'pods-native.test': { idp: identity.origin } }),
      } })
      page = await app.firstWindow()
      await until(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state === 'ready', 'desktop worker')
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setFocusable(false); BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false) })
    }
    await launchDesktop()
    cleanups.push(() => app.close())
    await page.evaluate(email => window.pods.onboarding({ type: 'connect', provider: 'openape', account: email }), email)
    const ownerLogin = await until(async () => (await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).connections.find(item => item.login?.url)?.login.url, 'desktop owner browser flow')
    const authorized = await fetch(ownerLogin, { headers: { authorization: `Bearer ${ownerToken}` }, redirect: 'manual' })
    assert.equal(authorized.status, 302)
    assert.equal((await fetch(authorized.headers.get('location'))).status, 200)
    await until(async () => {
      const connections = (await page.evaluate(() => window.pods.onboarding({ type: 'list' }))).connections
      const owner = connections.find(item => item.provider === 'openape')
      if (owner?.error) throw new Error(`Desktop owner sign-in: ${owner.error}`)
      return owner?.state === 'ready'
    }, 'desktop owner token exchange')
    async function menu(action, expectedCode) {
      await app.evaluate(({ Menu, dialog, shell }, { action, expectedCode, cli, descriptor }) => {
        globalThis.acceptance = { browser: null, error: null, paired: null }
        shell.openExternal = async url => { globalThis.acceptance.browser = url }
        dialog.showErrorBox = (_title, error) => { globalThis.acceptance.error = error }
        dialog.showMessageBox = async (_window, options) => {
          if (options.title === 'Mobile access') return { response: action, checkboxChecked: false }
          if (options.title === 'Pair mobile device') {
            if (options.message !== expectedCode) throw new Error('Pairing codes do not match')
            globalThis.acceptance.paired = options.message
          }
          return { response: 1, checkboxChecked: false }
        }
        let selected = 0
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected++ ? descriptor : cli] })
        Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === 'Mobile access…').click()
      }, { action, expectedCode, cli, descriptor })
    }
    await menu(1)
    const browserUrl = await until(() => app.evaluate(() => { if (globalThis.acceptance.error) throw new Error(globalThis.acceptance.error); return globalThis.acceptance.browser }), 'runtime registration browser')
    const start = await fetch(browserUrl, { redirect: 'manual' }); assert.equal(start.status, 302)
    const browserCookie = start.headers.getSetCookie().map(item => item.split(';')[0]).join('; ')
    const runtimeAuthorization = await fetch(start.headers.get('location'), { headers: { authorization: `Bearer ${ownerToken}` }, redirect: 'manual' }); assert.equal(runtimeAuthorization.status, 302)
    const callback = await fetch(runtimeAuthorization.headers.get('location'), { headers: { cookie: browserCookie }, redirect: 'manual' }); assert.equal(callback.status, 200)
    await until(async () => {
      const store = new DatabaseSync(join(profile, 'control.sqlite'), { readOnly: true })
      try { return store.prepare('SELECT enabled FROM remote_registration WHERE id=1').get()?.enabled === 1 }
      finally { store.close() }
    }, 'registered desktop')
    await menu(4)
    await until(async () => {
      const store = new DatabaseSync(join(profile, 'control.sqlite'), { readOnly: true })
      try { return store.prepare('SELECT count(*) AS count FROM remote_program_catalog').get().count === 1 }
      finally { store.close() }
    }, 'desktop-offered installed CLI')
    const approved = []; const programApprovals = []
    async function controlRow(sql, description) {
      await until(async () => {
        const store = new DatabaseSync(join(profile, 'control.sqlite'), { readOnly: true })
        try { return store.prepare(sql).get()?.ok === 1 }
        finally { store.close() }
      }, description)
    }
    async function state() {
      const workspace = await page.evaluate(() => window.pods.workspace({ type: 'list' }))
      const pod = workspace.pods[0]
      if (!pod) return { pod: null, runs: [], approvals: [], expectedResult, failures }
      const runs = await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), pod.id)
      return { pod, ...runs, expectedResult, failures }
    }
    const control = createServer(tls, (request, response) => {
      const handle = async () => {
        assert.equal(request.headers['x-fixture-token'], controlToken)
        let raw = ''; for await (const chunk of request) raw += chunk
        const body = raw ? JSON.parse(raw) : {}
        let result = { ok: true }
        if (request.url === '/state') result = await state()
        else if (request.url === '/pair') {
          await until(async () => {
            await menu(2, body.code)
            const result = await until(() => app.evaluate(() => globalThis.acceptance.error || globalThis.acceptance.paired), 'desktop pairing dialog')
            if (result === 'Sign in on your iPhone or iPad with the same owner first') { await delay(500); return false }
            assert.equal(result, body.code)
            return true
          }, 'desktop device discovery and matching pairing')
        }
        else if (request.url === '/authorize-program') {
          const current = await state()
          assert.ok(current.pod)
          assert.equal(current.runs.length, 0)
          const resources = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), current.pod.id)
          const program = resources.resources.find(item => item.configuration.type === 'program')
          assert.ok(program)
          assert.deepEqual(program.configuration.grants, [])
          await app.evaluate(({ dialog }) => {
            dialog.showMessageBox = async (_window, options) => {
              if (options.title !== 'Allow application command' || options.message !== 'Read native acceptance result' || !options.detail.includes('mobile-acceptance.acceptance[*]#read')) throw new Error(`Unexpected desktop command permission review: ${JSON.stringify({ title: options.title, message: options.message, detail: options.detail })}`)
              globalThis.acceptance.commandReview = { title: options.title, message: options.message, detail: options.detail }
              return { response: 1, checkboxChecked: false }
            }
          })
          await page.evaluate(({ podId, applicationId, epoch }) => window.pods.programs({ type: 'grant', podId, applicationId, epoch, argv: ['read'] }), { podId: current.pod.id, applicationId: program.id, epoch: resources.epoch })
          const review = await app.evaluate(() => globalThis.acceptance.commandReview)
          assert.ok(review)
          const updated = await page.evaluate(podId => window.pods.resources({ type: 'list', podId }), current.pod.id)
          const grants = updated.resources.find(item => item.id === program.id).configuration.grants
          assert.equal(grants.length, 1)
          const grant = await json(`${idp.url}/api/grants/${grants[0].authority.grantId}`, undefined, { authorization: `Bearer ${ownerToken}` })
          assert.equal(grant.status, 'approved')
          assert.equal(grant.request.target_host, `pods:${current.pod.id}`)
          assert.equal(grant.request.grant_type, 'always')
          assert.ok(grant.request.authorization_details.every(detail => detail.cli_id === 'mobile-acceptance' && detail.action === 'read'))
          programApprovals.push(grant.id)
          result = { review, grantId: grant.id }
        }
        else if (request.url === '/approve') {
          const current = await state()
          assert.equal(current.runs.length, 1); assert.equal(current.runs[0].state, 'running')
          const pending = current.approvals.filter(item => item.state === 'pending')
          assert.ok(pending.length > 0, 'The run must wait for the original identity provider')
          for (const approval of pending) {
            assert.equal(approval.issuer, identity.origin)
            const grant = await json(`${idp.url}/api/grants/${approval.grantId}`, undefined, { authorization: `Bearer ${ownerToken}` })
            assert.equal(grant.request.target_host, `pods:${current.pod.id}`); assert.equal(grant.request.audience, 'shapes'); assert.equal(grant.status, 'pending')
            assert.ok(grant.request.authorization_details.every(detail => ['pod-runtime', 'mobile-acceptance'].includes(detail.cli_id)))
            await json(`${idp.url}/api/grants/${approval.grantId}/approve`, {}, { authorization: `Bearer ${ownerToken}` })
            approved.push(approval.grantId)
          }
        }
        else if (request.url === '/verify') {
          const current = await state(); assert.equal(current.runs.length, 1); assert.equal(current.runs[0].state, 'completed'); assert.equal(current.runs[0].summary, expectedResult)
          assert.equal(approved.length, 1); assert.equal(programApprovals.length, 1); assert.deepEqual(failures, []); assert.deepEqual(identity.failures, []); assert.deepEqual(mediation.failures, [])
          const chat = await page.evaluate(podId => window.pods.master({ type: 'list', podId }), current.pod.id)
          assert.ok(chat.messages.some(item => item.role === 'user' && item.text === 'Prepare the assigned read command.'))
          assert.ok(chat.messages.some(item => item.text === 'The reviewed desktop script is ready.'))
          assert.equal(current.pod.lifecycle, 'paused')
          await page.reload(); await page.locator('.pod-button').first().click(); await page.getByRole('tab', { name: 'History', exact: true }).click()
          await page.getByText(expectedResult, { exact: true }).waitFor()
          await mkdir('.artifacts', { recursive: true }); await page.screenshot({ path: `.artifacts/${family}-desktop-result.png` })
          const evidence = { family, ownerProfileUsed: false, liveModelUsed: false, actualDDISA: true, actualDesktop: true, nativeClient: true, encryptedTransport: true, approvedGrants: [...programApprovals, ...approved], desktopCommandSetupRequired: true, runId: current.runs[0].id, result: expectedResult, modelCalls }
          await writeFile(`.artifacts/${family}-native-flow.json`, JSON.stringify(evidence, null, 2))
          result = evidence
        }
        else if (request.url === '/restart-desktop') {
          await app.close(); await launchDesktop()
          await controlRow('SELECT enabled AS ok FROM remote_registration WHERE id=1', 'registration retained across desktop restart')
          const current = await state(); assert.equal(current.runs.length, 1); assert.equal(current.runs[0].state, 'completed')
        }
        else if (request.url === '/revoke-device') {
          await menu(6)
          await controlRow('SELECT count(*)=0 AS ok FROM remote_devices WHERE revoked=0', 'desktop removed the paired device')
        }
        else if (request.url === '/refused') {
          const current = await state(); assert.equal(current.runs.length, 1)
          await controlRow('SELECT count(*)=0 AS ok FROM remote_inbox WHERE state IN (\'received\',\'unknown\')', 'no pending or unknown remote command after refusal')
          result = { runs: current.runs.length }
        }
        else throw new Error('Unknown acceptance action')
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result))
      }
      void handle().catch(error => { failures.push(String(error)); response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) })) })
    })
    await new Promise(resolve => control.listen(0, '127.0.0.1', resolve)); cleanups.push(async () => { control.closeAllConnections(); await new Promise(resolve => control.close(resolve)) })
    return { origin: mediation.origin, certificate: tls.path, email, control: `https://127.0.0.1:${control.address().port}`, controlToken, close }
  }
  catch (error) { await close(); throw error }
}
