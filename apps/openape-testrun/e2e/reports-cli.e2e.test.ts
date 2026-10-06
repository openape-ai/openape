import type { RunningServer } from 'openape-e2e/lifecycle'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { DdisaAgentTokens } from '../../openape-pods/src/main/programs/ddisa-agent'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = resolve(root, '../..')
const directory = makeTempDir('reports-cli-e2e-')
const owner = 'owner@reports.test'
const managementToken = 'reports-cli-disposable-management'
const bridgeSecret = 'reports-plans-bridge-synthetic-secret-1429'
const cliHome = join(directory, 'auth')
let idp: RunningServer; let reports: RunningServer; let plans: RunningServer
let reportsToken = ''; let plansToken = ''
function run(binary: 'reports' | 'plans', args: string[], expected = 0) {
  const path = join(workspace, binary === 'reports' ? 'packages/ape-testruns/dist/reports.mjs' : 'packages/ape-plans/dist/cli.mjs')
  const endpoint = binary === 'reports' ? reports.url : plans.url
  const env = { ...process.env, HOME: directory, OPENAPE_CLI_AUTH_HOME: cliHome, APE_PLANS_CONFIG_HOME: join(directory, 'plans-config') }
  let output: string
  try {
    output = execFileSync(process.execPath, [path, ...args, '--endpoint', endpoint, '--json'], { env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  catch (error) {
    const failure = error as { status?: number, stderr?: string }
    expect(failure.status, failure.stderr).toBe(expected)
    return JSON.parse(String(failure.stderr))
  }
  expect(expected, output).toBe(0)
  return binary === 'plans' && args[0] === 'status' ? output.trim() : JSON.parse(output)
}
async function api(service: RunningServer, token: string, method: string, path: string, body?: unknown) {
  return fetch(`${service.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
}
beforeAll(async () => {
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'reports.test': { version: 'ddisa1', idp: 'https://idp.reports.test', mode: 'open' } } })
  const common = { NUXT_IGNORE_LOCK: '1', NUXT_OPENAPE_SP_SESSION_SECRET: 'disposable-cli-session-secret-at-least-32-characters', NUXT_FALLBACK_IDP_URL: idp.url, OPENAPE_SP_ALLOW_INSECURE_IDP: '1', DDISA_MOCK_RECORDS: JSON.stringify({ 'reports.test': { version: 'ddisa1', idp: idp.url, mode: 'open' } }) }
  reports = await startServer({ cwd: root, readyPath: '/api/health', timeoutMs: 180000, env: ({ url }) => ({ ...common, NUXT_TURSO_URL: `file:${join(directory, 'reports.db')}`, NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_PUBLIC_URL: url, NUXT_HTML_PUBLISHING_ENABLED: 'true', NUXT_PLANS_CONSOLIDATED: 'true', NUXT_PLANS_BRIDGE_SECRET: bridgeSecret, NUXT_PLANS_INVITE_SECRET: 'synthetic-plans-invites-secret-at-least-32' }) })
  plans = await startServer({ cwd: join(workspace, 'apps/openape-plans'), readyPath: '/api/health', timeoutMs: 180000, env: ({ url }) => ({ ...common, NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_REPORTS_ORIGIN: reports.url, NUXT_REPORTS_BRIDGE_SECRET: bridgeSecret, NUXT_TURSO_URL: 'file:/nonexistent-parent/must-not-open-legacy.db' }) })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const sshKey = keyObjectToSshString(publicKey, owner)
  for (const [path, body] of [['/api/admin/users', { email: owner, name: 'Synthetic owner', password: 'synthetic-test-password' }], [`/api/admin/users/${owner}/ssh-keys`, { publicKey: sshKey, name: 'Fixture' }]] as const) {
    const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status, await response.text()).toBeLessThan(300)
  }
  const raw = await loginWithSshKey(idp.url, owner, privateKey, sshKey)
  mkdirSync(join(cliHome, 'sp-tokens'), { recursive: true, mode: 0o700 })
  for (const [service, audience] of [[reports, 'testrun.openape.ai'], [plans, 'plans.openape.ai']] as const) {
    const response = await api(service, '', 'POST', '/api/cli/exchange', { subject_token: raw })
    expect(response.status, await response.clone().text()).toBe(201)
    const token = (await response.json()).access_token
    if (service === reports) reportsToken = token
    else plansToken = token
    writeFileSync(join(cliHome, 'sp-tokens', `${audience}.json`), JSON.stringify({ aud: audience, endpoint: service.url, access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600 }), { mode: 0o600 })
  }
}, 300000)
afterAll(async () => { await plans?.stop(); await reports?.stop(); await idp?.stop() })

describe('built CLI and Plans compatibility journeys', () => {
  it('publishes three single files, discovers shared tags, exports immutable bytes and rejects stale writes', () => {
    const receipts = ['analysis', 'testrun', 'plan'].map(name => run('reports', ['publish', join(workspace, `packages/ape-testruns/examples/${name}.html`), '--key', `journey-${name}`]))
    const id = receipts[0].document_id
    expect(receipts.every(item => item.audience === 'private' && item.expires_at === null)).toBe(true)
    expect(run('reports', ['list', '--tag', 'reports', '--tag', 'consolidation']).items).toHaveLength(3)
    expect(run('reports', ['list', '--category', 'Test Runs', '--tag', 'reports']).items).toHaveLength(1)
    expect(run('reports', ['receipt', '--key', 'journey-analysis'])).toMatchObject({ document_id: id, version: 1 })
    const update = run('reports', ['update', id, '--expected-version', '1', '--key', 'journey-update', '--title', 'Updated analysis'])
    expect(update.version).toBe(2)
    expect(run('reports', ['update', id, '--expected-version', '1', '--key', 'journey-stale', '--title', 'Stale'], 6).error.code).toBe('CONFLICT')
    expect(run('reports', ['show', id, '--revision', '1']).title).not.toBe('Updated analysis')
    const output = join(directory, 'exported.html')
    run('reports', ['export', id, '--revision', '1', '--output', output])
    expect(readFileSync(output, 'utf8')).toBe(readFileSync(join(workspace, 'packages/ape-testruns/examples/analysis.html'), 'utf8'))
    run('reports', ['access', 'set', id, '--public', '--expected-access-revision', '1'])
    expect(run('reports', ['access', 'set', id, '--private', '--expected-access-revision', '1'], 6).error.code).toBe('CONFLICT')
    run('reports', ['retention', 'set', id, '--expires-in', '1d', '--expected-retention-revision', '1'])
    expect(run('reports', ['retention', 'set', id, '--permanent', '--expected-retention-revision', '1'], 6).error.code).toBe('CONFLICT')
    run('reports', ['rm', id, '--expected-version', '2'])
    run('reports', ['restore', id, '--permanent'])
    expect(run('reports', ['access', 'show', id])).toMatchObject({ audience: 'private' })
  })
  it('routes old URLs and versioned source writes through one store without opening the legacy database', async () => {
    const teamResponse = await api(plans, plansToken, 'POST', '/api/teams', { name: 'Compatibility fixture' })
    expect(teamResponse.status, await teamResponse.clone().text()).toBe(201)
    const team = await teamResponse.json()
    const source = join(directory, 'source.md'); writeFileSync(source, '# Original source\n\nPreserve editing.')
    const created = run('plans', ['new', '--team', team.id, '--title', 'Compatible Plan', '--body-from-file', source])
    expect(created).toMatchObject({ status: 'draft', version: 1 })
    expect(run('plans', ['show', created.id])).toMatchObject({ body_md: readFileSync(source, 'utf8'), version: 1 })
    writeFileSync(source, '# Changed source\n\nPreserved after consolidation.')
    run('plans', ['edit', created.id, '--body-from-file', source])
    run('plans', ['status', created.id, 'done'])
    expect(run('plans', ['show', created.id])).toMatchObject({ status: 'done', version: 3, body_md: readFileSync(source, 'utf8') })
    expect(run('reports', ['show', created.id])).toMatchObject({ metadata: { 'plans.status': 'done' }, version: 3 })
    expect((await api(plans, plansToken, 'PATCH', `/api/plans/${created.id}`, { status: 'active' })).status).toBe(428)
    expect((await api(plans, plansToken, 'PATCH', `/api/plans/${created.id}`, { status: 'active', expected_version: 1 })).status).toBe(409)
    const redirect = await fetch(`${plans.url}/teams/${team.id}/plans/${created.id}/edit`, { redirect: 'manual' })
    expect(redirect.status).toBe(302); expect(redirect.headers.get('location')).toBe(`${reports.url}/d/${created.id}/edit`)
    expect((await fetch(`${reports.url}/api/plans-compat/plans/${created.id}`, { headers: { 'x-openape-plans-bridge': 'forged' } })).status).toBe(401)
    expect((await api(reports, plansToken, 'GET', `/api/plans-compat/plans/${created.id}`)).status).toBe(401)
    expect((await api(reports, reportsToken, 'GET', `/api/plans-compat/plans/${created.id}`)).status).toBe(200)
  })
  it('permits a bound raw publisher to update and recover receipts without read or policy rights', async () => {
    const publisher = 'publisher@reports.test'
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const created = await fetch(`${idp.url}/api/admin/agents`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: publisher, name: 'Synthetic publisher', owner, approver: owner, publicKey: keyObjectToSshString(publicKey, publisher) }) })
    expect(created.status, await created.text()).toBeLessThan(300)
    const tokens = new DdisaAgentTokens(fetch)
    const token = await tokens.bearer('synthetic-report', { type: 'ddisaAgent', credential: 'fixture', subject: publisher, issuer: idp.url }, 'fixture', async () => privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), new AbortController().signal)
    const series = await (await api(reports, reportsToken, 'POST', '/api/report-series', { name: 'Synthetic publisher series' })).json()
    expect((await api(reports, reportsToken, 'PUT', `/api/report-series/${series.id}/publisher`, { publisher, expectedRevision: 1 })).status).toBe(200)
    const publish = (body: unknown, key: string) => fetch(`${reports.url}/api/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) })
    const html = readFileSync(join(workspace, 'packages/ape-testruns/examples/analysis.html'), 'utf8')
    const first = await publish({ schemaVersion: 2, html, seriesId: series.id }, 'bound-v1')
    expect(first.status, await first.clone().text()).toBe(201); const document = await first.json()
    const update = { schemaVersion: 2, html, documentId: document.document_id, expectedVersion: 1 }
    expect((await publish(update, 'bound-v2')).status).toBe(201)
    expect(await (await api(reports, token, 'GET', '/api/documents/receipt?key=bound-v2')).json()).toMatchObject({ document_id: document.document_id, version: 2 })
    expect((await api(reports, token, 'GET', `/api/documents/${document.document_id}`)).status).toBe(404)
    expect((await api(reports, token, 'POST', `/api/documents/${document.document_id}/access`, { audience: { mode: 'public' }, expectedAccessRevision: 1 })).status).toBe(401)
    expect((await api(reports, reportsToken, 'PUT', `/api/report-series/${series.id}/publisher`, { publisher: null, expectedRevision: 2 })).status).toBe(200)
    expect((await publish(update, 'bound-v2')).status).toBe(401)
    expect((await api(reports, token, 'GET', '/api/documents/receipt?key=bound-v2')).status).toBe(404)
  })

})
