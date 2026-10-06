import type { RunningServer } from 'openape-e2e/lifecycle'
import type { Browser } from 'playwright'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, '.artifacts/html-documents')
const examples = resolve(root, '../../packages/ape-testruns/examples')
const owner = 'owner@reports.test'; const reader = 'reader@reports.test'
const managementToken = 'html-disposable-management-token'
let idp: RunningServer; let app: RunningServer; let browser: Browser
let base = ''; let content = ''; let ownerToken = ''; let ownerRaw = ''; let readerToken = ''
const documents: { id: string, title: string, source: string }[] = []
async function call(method: string, path: string, body?: unknown, token = ownerToken, extra = {}) {
  return fetch(`${base}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
}
async function identity(email: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const sshKey = keyObjectToSshString(publicKey, email)
  for (const [path, body] of [['/api/admin/users', { email, name: email, password: 'fixture-password-for-reports' }], [`/api/admin/users/${email}/ssh-keys`, { publicKey: sshKey, name: 'Fixture key' }]] as const) {
    const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status, await response.text()).toBeLessThan(300)
  }
  const raw = await loginWithSshKey(idp.url, email, privateKey, sshKey)
  const response = await call('POST', '/api/cli/exchange', { subject_token: raw }, '')
  expect(response.status).toBe(201)
  return { raw, token: (await response.json()).access_token as string }
}
beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true })
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'reports.test': { version: 'ddisa1', idp: 'https://idp.reports.test', mode: 'open' } } })
  app = await startServer({ cwd: root, readyPath: '/api/health', timeoutMs: 180000, env: ({ url }) => ({
    NUXT_HTML_PUBLISHING_ENABLED: 'true', NUXT_PLANS_CONSOLIDATED: 'true', NUXT_PLANS_INVITE_SECRET: 'synthetic-plans-invite-secret-at-least-32', NUXT_IGNORE_LOCK: '1', NUXT_TURSO_URL: `file:${join(makeTempDir('html-e2e-'), 'reports.db')}`, NUXT_OPENAPE_SP_SESSION_SECRET: 'html-e2e-secret-at-least-32-characters-long', NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_FALLBACK_IDP_URL: idp.url, NUXT_PUBLIC_URL: url, NUXT_BRIEFING_URL: url,
    NUXT_HTML_CONTENT_ORIGIN: url.replace('127.0.0.1', 'localhost'), NUXT_PUBLIC_HTML_CONTENT_ORIGIN: url.replace('127.0.0.1', 'localhost'),
    DDISA_MOCK_RECORDS: JSON.stringify({ 'reports.test': { version: 'ddisa1', idp: idp.url, mode: 'open' } }), OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
  }) })
  base = app.url; content = base.replace('127.0.0.1', 'localhost')
  const first = await identity(owner); ownerToken = first.token; ownerRaw = first.raw; readerToken = (await identity(reader)).token
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
}, 300000)
afterAll(async () => { await browser?.close(); await app?.stop(); await idp?.stop() })

describe('authenticated single-file HTML delivery', () => {
  it('publishes three independent styles with private defaults and exact bytes', async () => {
    for (const name of ['analysis', 'testrun', 'plan']) {
      const source = readFileSync(join(examples, `${name}.html`), 'utf8')
      const response = await call('POST', '/api/documents', { schemaVersion: 2, html: source }, ownerToken, { 'idempotency-key': name })
      expect(response.status, await response.clone().text()).toBe(201)
      const receipt = await response.json(); expect(receipt).toMatchObject({ version: 1, audience: 'private', expires_at: null })
      const show = await call('GET', `/api/documents/${receipt.document_id}`); const metadata = await show.json()
      documents.push({ id: receipt.document_id, title: metadata.title, source })
      expect(await (await call('GET', `/api/documents/${receipt.document_id}/html`)).text()).toBe(source)
      if (name === 'analysis') {
        expect((await call('GET', `/api/documents/${receipt.document_id}`, undefined, '')).status).toBe(404)
        expect((await call('GET', `/api/documents/${receipt.document_id}/html`, undefined, readerToken)).status).toBe(404)
      }
    }
  })
  it('keeps application identity outside active HTML and renders offline in desktop, narrow and dark shells', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }); const page = await context.newPage(); const diagnostics: string[] = []
    page.on('pageerror', error => diagnostics.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(message.text()) })
    page.on('requestfailed', request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`))
    const login = await context.request.post(`${base}/api/login`, { data: { email: owner } })
    expect(login.status(), await login.text()).toBe(200)
    const authorization = await context.request.get((await login.json()).redirectUrl, { headers: { authorization: `Bearer ${ownerRaw}` }, maxRedirects: 0 })
    expect(authorization.status()).toBe(302)
    await page.goto(authorization.headers().location!); await page.waitForURL('**/reports')
    await page.goto(`${base}/reports`)
    const collection = page.getByRole('region', { name: 'HTML reports' })
    await collection.getByLabel('Tags (all, separated by commas)').fill('reports,consolidation')
    await expect.poll(() => collection.locator('article').count()).toBe(3)
    await collection.getByRole('combobox', { name: /^Category/u }).selectOption('Test Runs')
    try { await expect.poll(() => collection.locator('article').count()).toBe(1) }
    catch (error) { await page.screenshot({ path: join(artifacts, 'collection-failure.png'), fullPage: true }); writeFileSync(join(artifacts, 'collection-diagnostics.json'), JSON.stringify({ diagnostics, text: await collection.textContent() }, null, 2)); throw error }
    await page.screenshot({ path: join(artifacts, 'collection-filtered.png'), fullPage: true })
    const timings = []
    for (const document of documents) {
      const start = Date.now(); await page.goto(`${base}/d/${document.id}`)
      await page.getByRole('button', { name: 'Open active document' }).click()
      const frame = page.frameLocator('iframe')
      try { await frame.locator('#total').waitFor({ timeout: 10000 }) }
      catch (error) { await page.screenshot({ path: join(artifacts, 'delivery-failure.png'), fullPage: true }); writeFileSync(join(artifacts, 'delivery-diagnostics.json'), JSON.stringify({ diagnostics, frames: page.frames().map(frame => frame.url()), text: await page.locator('body').textContent() }, null, 2)); throw error }
      expect(await frame.locator('#total').textContent()).toBe('60')
      const inner = page.frames().find(item => item.url().startsWith(content))!
      expect(inner).toBeDefined()
      expect(await inner.evaluate(async () => { await document.fonts.ready; return { image: document.querySelector('img')!.naturalWidth, font: document.fonts.check('16px ExampleMark'), vector: Boolean(document.querySelector('svg')), canvas: document.querySelector('canvas')!.width } })).toEqual({ image: 300, font: true, vector: true, canvas: 600 })
      expect(await inner.evaluate(() => {
        const denied = []; for (const probe of [() => parent.document.title, () => document.cookie, () => localStorage.length]) {
          try { probe(); denied.push(false) }
          catch { denied.push(true) }
        } return denied
      })).toEqual([true, true, true])
      await context.setOffline(true)
      await frame.locator('#factor').fill('3'); await frame.locator('#factor').dispatchEvent('input'); expect(await frame.locator('#total').textContent()).toBe('180')
      await context.setOffline(false)
      timings.push({ title: document.title, html_bytes: Buffer.byteLength(document.source), ready_ms: Date.now() - start })
      await page.screenshot({ path: join(artifacts, `${document.id}-desktop.png`), fullPage: true })
      if (document === documents[0]) {
        for (const theme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: theme })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.evaluate(() => window.scrollTo(0, 0)); await inner.evaluate(() => window.scrollTo(0, 0))
          expect(await page.locator('.html-report').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(theme === 'dark' ? 'rgb(20, 35, 31)' : 'rgb(247, 246, 241)')
          await page.screenshot({ path: join(artifacts, `narrow-${theme}.png`) })
        }
        await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' })
      }
    }
    writeFileSync(join(artifacts, 'measurements.json'), JSON.stringify({ browser: browser.version(), timings }, null, 2))
    await context.close()
  })
  it('rechecks access and rejects direct content navigation, application routes and stale capabilities', async () => {
    const id = documents[0]!.id
    const response = await call('POST', `/api/documents/${id}/viewer`, undefined, ownerToken, { origin: base })
    expect(response.status, await response.clone().text()).toBe(200); const capability = await response.json()
    expect((await fetch(capability.url)).status).toBe(403)
    for (const path of ['/api/cli/me', '/api/documents', '/api/login', '/reports']) expect((await fetch(`${content}${path}`)).status).toBe(404)
    const original = await fetch(capability.url, { headers: { 'sec-fetch-dest': 'iframe' } })
    expect(original.status).toBe(200); expect(original.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(original.headers.get('set-cookie')).toBeNull(); expect(original.headers.get('referrer-policy')).toBe('no-referrer')
    expect((await call('POST', `/api/documents/${id}/access`, { audience: { mode: 'readers', readers: [reader] }, expectedAccessRevision: 1 })).status).toBe(200)
    expect((await call('GET', `/api/documents/${id}`, undefined, readerToken)).status).toBe(200)
    expect((await fetch(capability.url, { headers: { 'sec-fetch-dest': 'iframe' } })).status).toBe(403)
    expect((await call('POST', `/api/documents/${id}/access`, { audience: { mode: 'public' }, expectedAccessRevision: 2 }, readerToken)).status).toBe(403)
    expect((await call('POST', `/api/documents/${id}/access`, { audience: { mode: 'public' }, expectedAccessRevision: 2 })).status).toBe(200)
    expect((await call('GET', `/api/documents/${id}`, undefined, '')).status).toBe(200)
    expect((await call('POST', `/api/documents/${id}/access`, { audience: { mode: 'private' }, expectedAccessRevision: 3 })).status).toBe(200)
    expect((await call('GET', `/api/documents/${id}?revision=1`, undefined, '')).status).toBe(404)
  })
  it('loads optional HTTPS images in the reader only, survives their loss, and denies expired public versions', async () => {
    const imageUrl = 'https://images.example.test/synthetic.png'
    const html = `<!doctype html><html lang="en"><title>External image example</title><body><h1>Provider-dependent image</h1><p>The report remains understandable without its image.</p><img src="${imageUrl}" alt="Unavailable provider image"><script>document.body.dataset.ready='yes'</script></body></html>`
    const published = await call('POST', '/api/documents', { schemaVersion: 2, html, audience: { mode: 'public' } }, ownerToken, { 'idempotency-key': 'external-example' })
    expect(published.status, await published.clone().text()).toBe(201); const document = await published.json()
    const context = await browser.newContext(); const page = await context.newPage(); const requests: Record<string, string>[] = []
    const png = /data:image\/png;base64,([^"\s]+)/u.exec(documents[0]!.source)![1]!
    await page.route(imageUrl, async (route) => { requests.push(await route.request().allHeaders()); await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }) })
    await page.goto(`${base}/d/${document.document_id}`); await page.getByText('1 external image reference(s)', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Open active document' }).click()
    const frame = page.frameLocator('iframe')
    await expect.poll(() => frame.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(300)
    expect(requests).toHaveLength(1); expect(requests[0]).not.toHaveProperty('cookie'); expect(requests[0]).not.toHaveProperty('authorization'); expect(requests[0]).not.toHaveProperty('referer')
    await page.screenshot({ path: join(artifacts, 'external-image.png'), fullPage: true })
    await page.unroute(imageUrl); await page.route(imageUrl, route => route.abort())
    await page.reload(); await page.getByRole('button', { name: 'Open active document' }).click()
    await frame.getByText('The report remains understandable without its image.').waitFor()
    expect(await frame.locator('img').getAttribute('alt')).toBe('Unavailable provider image')
    await page.screenshot({ path: join(artifacts, 'external-unavailable.png'), fullPage: true })
    await context.close()
    const expiresAt = new Date(Date.now() + 1500).toISOString()
    expect((await call('POST', `/api/documents/${document.document_id}/retention`, { lifetime: { expiresAt }, expectedRetentionRevision: 1 })).status).toBe(200)
    await expect.poll(async () => (await call('GET', `/api/documents/${document.document_id}?revision=1`, undefined, '')).status, { timeout: 5000, interval: 1000 }).toBe(410)
    expect((await call('GET', `/api/documents/${document.document_id}/html?revision=1`, undefined, '')).status).toBe(410)
    expect((await call('POST', `/api/documents/${document.document_id}/restore`, { lifetime: { permanent: true } })).status).toBe(200)
    expect((await call('GET', `/api/documents/${document.document_id}`, undefined, '')).status).toBe(404)
  })

})
