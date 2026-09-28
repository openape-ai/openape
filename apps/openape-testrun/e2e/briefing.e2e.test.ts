import type { RunningServer } from 'openape-e2e/lifecycle'
import type { Browser } from 'playwright'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeJwt } from 'jose'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import { DdisaAgentTokens } from '../../openape-pods/src/main/programs/ddisa-agent'
import { sampleBriefing } from '../tests/briefing-fixture'

const owner = 'owner@reports.test'; const publisher = 'publisher@reports.test'
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const managementToken = 'reports-disposable-management-token'
let idp: RunningServer; let app: RunningServer; let browser: Browser
let ownerToken = ''; let idpToken = ''; let agentToken = ''; let otherToken = ''; let base = ''; let alias = ''
let series: { id: string, slug: string }; let edition: { id: string, slug: string, version: number, digest: string, url: string, edition_url: string }
async function call(method: string, path: string, body?: unknown, token = ownerToken, extra = {}) {
  return await fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function admin(path: string, body: unknown) {
  const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect(response.status, await response.text()).toBeLessThan(300)
}
async function identity(email: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const sshKey = keyObjectToSshString(publicKey, email)
  await admin('/api/admin/users', { email, name: email, password: 'fixture-password-for-reports' })
  await admin(`/api/admin/users/${email}/ssh-keys`, { publicKey: sshKey, name: 'Fixture key' })
  const raw = await loginWithSshKey(idp.url, email, privateKey, sshKey)
  const response = await call('POST', '/api/cli/exchange', { subject_token: raw }, '')
  expect(response.status).toBe(201)
  return { raw, token: (await response.json()).access_token as string }
}
beforeAll(async () => {
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'reports.test': { version: 'ddisa1', idp: 'https://idp.reports.test', mode: 'open' } } })
  app = await startServer({ cwd: appRoot, readyPath: '/api/health', timeoutMs: 180000, env: ({ url }) => ({
    NUXT_IGNORE_LOCK: '1', NUXT_TURSO_URL: `file:${join(makeTempDir('reports-e2e-'), 'reports.db')}`, NUXT_OPENAPE_SP_SESSION_SECRET: 'reports-e2e-secret-at-least-32-characters-long', NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_FALLBACK_IDP_URL: idp.url, NUXT_PUBLIC_URL: url, NUXT_BRIEFING_URL: url,
    NUXT_OPENAPE_SP_ADDITIONAL_REDIRECT_URIS: JSON.stringify([`${url.replace('127.0.0.1', 'localhost')}/api/callback`]),
    DDISA_MOCK_RECORDS: JSON.stringify({ 'reports.test': { version: 'ddisa1', idp: idp.url, mode: 'open' } }), OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
  }) })
  base = app.url; alias = base.replace('127.0.0.1', 'localhost')
  const primary = await identity(owner); ownerToken = primary.token; idpToken = primary.raw
  otherToken = (await identity('other@reports.test')).token
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  await admin('/api/admin/agents', { email: publisher, name: 'Reports publisher', owner, approver: owner, publicKey: keyObjectToSshString(publicKey, publisher) })
  const authentication = { type: 'ddisaAgent' as const, credential: 'fixture-key', subject: publisher, issuer: idp.url }
  const tokens = new DdisaAgentTokens(fetch)
  const readKey = async () => privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  agentToken = await tokens.bearer('fixture-pod', authentication, 'fixture-key', readKey, new AbortController().signal)
  expect(decodeJwt(agentToken)).toMatchObject({ sub: publisher, aud: 'apes-cli', act: 'agent', iss: idp.url })
  tokens.reject('fixture-pod', authentication)
  agentToken = await tokens.bearer('fixture-pod', authentication, 'fixture-key', readKey, new AbortController().signal)
  expect(decodeJwt(agentToken).exp).toBeGreaterThan(Date.now() / 1000)
}, 300000)
afterAll(async () => { await browser?.close(); await app?.stop(); await idp?.stop() })

describe('private briefing publication and viewing', () => {
  it('creates an owner-bound series and publishes through the actual Pods token flow', async () => {
    expect((await call('POST', '/api/report-series', { name: 'Morning', owner: 'other@reports.test' })).status).toBe(400)
    const response = await call('POST', '/api/report-series', { name: 'Morning briefing' })
    expect(response.status).toBe(201); series = await response.json()
    expect((await call('PUT', `/api/report-series/${series.id}/publisher`, { publisher, expectedRevision: 1 }, otherToken)).status).toBe(404)
    expect((await call('PUT', `/api/report-series/${series.id}/publisher`, { publisher, expectedRevision: 1 })).status).toBe(200)
    const body = sampleBriefing(series.id)
    const publication = await call('POST', '/api/reports', body, agentToken, { 'idempotency-key': 'morning:2026-09-27' })
    expect(publication.status, await publication.clone().text()).toBe(201); edition = await publication.json()
    expect(edition.version).toBe(1)
    const replay = await call('POST', '/api/reports', body, agentToken, { 'idempotency-key': 'morning:2026-09-27' })
    expect(replay.status).toBe(200); expect((await replay.json()).id).toBe(edition.id)
    expect((await call('POST', '/api/reports', { ...body, overview: 'Changed' }, agentToken, { 'idempotency-key': 'morning:2026-09-27' })).status).toBe(409)
    const receipt = await call('GET', `/api/report-series/${series.id}/editions/2026-09-27/publication`, undefined, agentToken)
    expect(await receipt.json()).toEqual({ id: edition.id, version: 1, digest: edition.digest, url: edition.url, edition_url: edition.edition_url })
  })
  it('denies anonymous, foreign-owner and publisher reads across pages, versions and assets', async () => {
    for (const path of [`/api/public/runs/${series.slug}`, `/api/public/runs/${series.slug}?v=1`, `/api/public/runs/${series.slug}/assets/private.png?v=1`]) {
      for (const [token, status] of [['', 401], [otherToken, 404], [agentToken, 401]] as const) {
        const response = await call('GET', path, undefined, token)
        expect(response.status).toBe(status)
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(await response.text()).not.toContain('A little clarity')
        const head = await call('HEAD', path, undefined, token, { 'if-none-match': '*', range: 'bytes=0-20' })
        expect([401, 404, 405]).toContain(head.status)
      }
    }
    for (const origin of [base, alias]) {
      const response = await fetch(`${origin}/r/${series.slug}?v=1`)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).not.toContain('The team has resolved')
    }
    expect((await call('GET', '/api/report-series', undefined, agentToken)).status).toBe(401)
    expect((await call('GET', '/api/runs', undefined, ownerToken)).status).toBe(200)
    expect(await (await call('GET', '/api/runs', undefined, ownerToken)).json()).toEqual([])
    expect((await call('DELETE', `/api/runs/${series.id}`)).status).toBe(404)
  })
  it('protects archived editions, unsafe payloads and revoked bindings', async () => {
    const second = await call('POST', '/api/reports', sampleBriefing(series.id, '2026-09-28'), agentToken, { 'idempotency-key': 'morning:2026-09-28' })
    expect(second.status).toBe(201)
    const latest = await (await call('GET', `/api/public/runs/${series.slug}`)).json()
    expect(latest).toMatchObject({ version: 2, latest_version: 2, briefing: { editionDate: '2026-09-28' } })
    expect((await (await call('GET', `/api/public/runs/${series.slug}?v=1`)).json()).briefing.editionDate).toBe('2026-09-27')
    const unsafe = sampleBriefing(series.id, '2026-09-29'); unsafe.nextActions[0]!.url = 'javascript:alert(1)'
    expect((await call('POST', '/api/reports', unsafe, agentToken, { 'idempotency-key': 'unsafe' })).status).toBe(400)
    expect((await call('PUT', `/api/report-series/${series.id}/publisher`, { publisher: null, expectedRevision: 2 })).status).toBe(200)
    expect((await call('POST', '/api/reports', sampleBriefing(series.id, '2026-09-29'), agentToken, { 'idempotency-key': 'revoked' })).status).toBe(401)
    expect((await call('GET', `/api/report-series/${series.id}/editions/2026-09-27/publication`, undefined, agentToken)).status).toBe(401)
  })
  it('renders real authenticated desktop, mobile and dark editions on both login origins', async () => {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    const artifacts = resolve(appRoot, '.artifacts/reports'); mkdirSync(artifacts, { recursive: true })
    for (const origin of [base, alias]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
      const page = await context.newPage()
      const errors: string[] = []; page.on('pageerror', (error) => { errors.push(error.message); console.error('Briefing browser:', error.message) })
      page.on('console', (message) => { if (message.type() === 'error') console.error('Briefing console:', message.text()) })
      page.setDefaultTimeout(15000)
      const login = await context.request.post(`${origin}/api/login`, { data: { email: owner } })
      expect(login.status(), await login.text()).toBe(200)
      const authorization = await context.request.get((await login.json()).redirectUrl, { headers: { authorization: `Bearer ${idpToken}` }, maxRedirects: 0 })
      expect(authorization.status()).toBe(302)
      expect(authorization.headers().location).toContain(`${origin}/api/callback?`)
      await page.goto(authorization.headers().location!)
      await page.waitForURL('**/reports')
      await page.goto(`${origin}/r/${series.slug}?v=1`)
      await page.getByRole('heading', { name: 'A little clarity for today.' }).waitFor()
      expect(await page.locator('.briefing').textContent()).toContain('Personal events may be missing')
      const cookie = (await context.cookies()).filter(item => item.name.startsWith('openape-sp')).map(item => `${item.name}=${item.value}`).join('; ')
      const mutation = await fetch(`${origin}/api/report-series`, { method: 'POST', body: JSON.stringify({ name: 'Cross origin' }), headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' } })
      expect(mutation.status, await mutation.text()).toBe(403)
      if (origin === base) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
          for (const theme of ['light', 'dark']) {
            await page.getByLabel('Darstellung', { exact: true }).selectOption(theme)
            await expect.poll(() => page.locator('.briefing').getAttribute('data-theme')).toBe(theme)
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ path: `${artifacts}/${width}-${theme}.png`, fullPage: true })
          }
        }
        await expect.poll(() => page.getByLabel('Frühere Ausgaben').inputValue()).toBe('1')
        await page.getByLabel('Frühere Ausgaben').selectOption('2')
        await page.waitForURL('**?v=2')
        await page.getByText('Ausgabe 2', { exact: true }).waitFor()
      }
      expect(errors).toEqual([])
      await context.close()
    }
    const screenshots = [1440, 390].flatMap(width => ['light', 'dark'].map(theme => ({ title: `${width}px · ${theme}`, shot: `${width}-${theme}.png` })))
    writeFileSync(`${artifacts}/testrun.json`, JSON.stringify({ title: 'OpenApe Reports — private briefing acceptance', project: 'OpenApe Reports', tests: [{ id: 'briefing', title: 'Real DDISA login, owner privacy, editions and responsive reading', status: 'passed', steps: screenshots }] }, null, 2))
    writeFileSync(`${artifacts}/report.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenApe Reports verification</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:auto;padding:30px;background:#f7f6f1;color:#213c36}img{max-width:100%;border:1px solid #ddd}section{margin:40px 0}strong{color:#326354}</style><h1>OpenApe Reports</h1><p><strong>Passed:</strong> actual DDISA callback on canonical and alias origins; owner-only viewing; immutable editions; mobile, desktop and light/dark rendering. Synthetic data only.</p>${screenshots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifacts}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`)
  }, 180000)
})
